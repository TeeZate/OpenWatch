# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Platform Certificate Authority.

The OpenWatch platform acts as its own CA. When a capability token is issued,
a matching client certificate is generated and signed by this CA. The probe
presents this certificate on every connection (application-layer mTLS).

On Railway, TLS termination happens at the load balancer, so true TLS-layer
mTLS is not achievable without custom infrastructure. We implement equivalent
security via application-layer cert verification: the probe includes its PEM
certificate in the X-OpenWatch-Client-Cert header; the server verifies it was
signed by the platform CA and that the CN matches the token_id in the payload.

Key pair (CA cert + CA private key) is loaded from env vars:
    PLATFORM_CA_CERT_B64  — base64(PEM cert)
    PLATFORM_CA_KEY_B64   — base64(PEM private key)

To generate a stable CA key pair and print env var commands, run:
    python -m core.cert_authority --generate-ca
"""

from __future__ import annotations

import base64
import datetime
import logging
import os
from functools import lru_cache

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID

logger = logging.getLogger(__name__)


# ── CA loading ────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_ca() -> tuple:
    """Load the platform CA cert + key from env vars, or generate an ephemeral pair."""
    cert_b64 = os.environ.get("PLATFORM_CA_CERT_B64")
    key_b64  = os.environ.get("PLATFORM_CA_KEY_B64")

    if cert_b64 and key_b64:
        try:
            ca_cert = x509.load_pem_x509_certificate(base64.b64decode(cert_b64))
            ca_key  = serialization.load_pem_private_key(
                base64.b64decode(key_b64), password=None
            )
            logger.info("Platform CA loaded from environment.")
            return ca_cert, ca_key
        except Exception as exc:
            logger.error("Failed to load Platform CA from env: %s", exc)
            raise RuntimeError("Invalid PLATFORM_CA env vars — cannot start cert authority.") from exc

    # ── Dev fallback: ephemeral CA ────────────────────────────────────────────
    logger.warning(
        "PLATFORM_CA_CERT_B64 / PLATFORM_CA_KEY_B64 not set. "
        "Generating an ephemeral CA — client certs will be invalid after restart. "
        "Run `python -m core.cert_authority --generate-ca` and set the env vars on Railway."
    )
    return _build_ca_cert_and_key()


def get_ca_cert_pem() -> str:
    """Return the CA certificate as a PEM string (safe to distribute to probes)."""
    ca_cert, _ = get_ca()
    return ca_cert.public_bytes(serialization.Encoding.PEM).decode()


# ── Client cert generation ────────────────────────────────────────────────────

def generate_client_cert(token_id: str, expires_days: int = 365) -> tuple[str, str]:
    """Generate an RSA client certificate for a probe, signed by the platform CA.

    The certificate's Common Name is set to `token_id` so the server can verify
    the cert matches the token in the payload without any extra database lookup.

    Returns:
        (cert_pem, key_pem) — both as PEM strings ready for file writing.
    """
    ca_cert, ca_key = get_ca()
    now = datetime.datetime.now(datetime.timezone.utc)

    client_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME,          token_id),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME,    "OpenWatch Probe"),
        ]))
        .issuer_name(ca_cert.subject)
        .public_key(client_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=expires_days))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, key_encipherment=True,
                content_commitment=False, data_encipherment=False,
                key_agreement=False, key_cert_sign=False,
                crl_sign=False, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )

    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
    key_pem  = client_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()

    return cert_pem, key_pem


# ── Client cert verification ──────────────────────────────────────────────────

def verify_client_cert(cert_pem_b64: str) -> tuple[bool, str | None]:
    """Verify a probe's client certificate against the platform CA.

    Checks:
        1. Certificate was signed by the platform CA
        2. Certificate has not expired
        3. CN field is present (contains the token_id)

    Returns:
        (valid: bool, token_id: str | None)
    """
    try:
        cert_pem   = base64.b64decode(cert_pem_b64)
        client_cert = x509.load_pem_x509_certificate(cert_pem)

        # ── Expiry check ──────────────────────────────────────────────────────
        now = datetime.datetime.now(datetime.timezone.utc)
        if client_cert.not_valid_after_utc < now:
            logger.debug("Client cert expired at %s", client_cert.not_valid_after_utc)
            return False, None

        # ── Signature verification against platform CA ────────────────────────
        ca_cert, _ = get_ca()
        ca_cert.public_key().verify(
            client_cert.signature,
            client_cert.tbs_certificate_bytes,
            padding.PKCS1v15(),
            client_cert.signature_hash_algorithm,  # type: ignore[arg-type]
        )

        # ── Extract token_id from CN ──────────────────────────────────────────
        attrs = client_cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
        if not attrs:
            logger.debug("Client cert has no CN field")
            return False, None

        return True, attrs[0].value

    except Exception as exc:
        logger.debug("Client cert verification failed: %s", exc)
        return False, None


# ── Internal helpers ──────────────────────────────────────────────────────────

def _build_ca_cert_and_key() -> tuple:
    """Build a fresh self-signed CA certificate."""
    now    = datetime.datetime.now(datetime.timezone.utc)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME,       "OpenWatch Platform CA"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "OpenWatch"),
        ]))
        .issuer_name(x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME,       "OpenWatch Platform CA"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "OpenWatch"),
        ]))
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=3650))  # 10 years
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, key_cert_sign=True, crl_sign=True,
                key_encipherment=False, content_commitment=False,
                data_encipherment=False, key_agreement=False,
                encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )
    return ca_cert, ca_key


# ── CLI CA generator ──────────────────────────────────────────────────────────

def _generate_and_print_ca() -> None:
    """Generate a fresh CA key pair and print Railway env var commands."""
    ca_cert, ca_key = _build_ca_cert_and_key()

    cert_pem = ca_cert.public_bytes(serialization.Encoding.PEM)
    key_pem  = ca_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )

    cert_b64 = base64.b64encode(cert_pem).decode()
    key_b64  = base64.b64encode(key_pem).decode()

    print("\n── OpenWatch Platform CA ────────────────────────────────────────────")
    print("Set these as Railway environment variables on the backend service:\n")
    print(f"PLATFORM_CA_CERT_B64={cert_b64}")
    print(f"PLATFORM_CA_KEY_B64={key_b64}")
    print("\nPLATFORM_CA_KEY_B64 is secret. Never commit it to git.")
    print("────────────────────────────────────────────────────────────────────\n")


if __name__ == "__main__":
    import sys
    if "--generate-ca" in sys.argv:
        _generate_and_print_ca()
    else:
        print("Usage: python -m core.cert_authority --generate-ca")
