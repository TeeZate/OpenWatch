# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Capability token issuer.

Generates Ed25519-signed capability tokens for authorized probe installations.
Each token is bound to a specific monitored system, carries explicit permission
scopes, and includes an expiry timestamp.

Key material is loaded from env vars (PLATFORM_PRIVATE_KEY_B64 /
PLATFORM_PUBLIC_KEY_B64). If not present, an ephemeral pair is generated with
a loud warning — this is acceptable for local development only.

To generate a stable key pair and print the env vars to set on Railway, run:
    python -m core.token_issuer --generate-keys
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
import uuid
from functools import lru_cache

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

logger = logging.getLogger(__name__)

# ── Allowed scopes ────────────────────────────────────────────────────────────

VALID_SCOPES = frozenset({"os", "services", "network", "processes", "logs"})
DEFAULT_SCOPES = ["os", "services", "network", "processes"]

# ── Key management ────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _load_private_key() -> Ed25519PrivateKey:
    """Load the platform Ed25519 private key from env, or generate an ephemeral one."""
    raw_b64 = os.environ.get("PLATFORM_PRIVATE_KEY_B64")
    if raw_b64:
        try:
            raw = base64.b64decode(raw_b64)
            key = Ed25519PrivateKey.from_private_bytes(raw)
            logger.info("Platform Ed25519 private key loaded from environment.")
            return key
        except Exception as exc:
            logger.error("Failed to load PLATFORM_PRIVATE_KEY_B64: %s", exc)
            raise RuntimeError("Invalid PLATFORM_PRIVATE_KEY_B64 — cannot start token issuer.") from exc

    # ── Dev fallback: ephemeral key ───────────────────────────────────────────
    logger.warning(
        "PLATFORM_PRIVATE_KEY_B64 is not set. "
        "Generating an ephemeral Ed25519 key pair — tokens will be invalid after restart. "
        "Run `python -m core.token_issuer --generate-keys` and set the env vars on Railway."
    )
    return Ed25519PrivateKey.generate()


def get_platform_public_key_b64() -> str:
    """Return the platform public key as a base64 string (included in every token)."""
    pub = _load_private_key().public_key()
    raw = pub.public_bytes(Encoding.Raw, PublicFormat.Raw)
    return base64.b64encode(raw).decode()


def verify_token_signature(token_dict: dict) -> bool:
    """Verify the Ed25519 signature on a token dict.

    Used by the probe validator (Component 2) to confirm the token was issued
    by this platform and has not been tampered with.
    """
    try:
        sig_b64 = token_dict.get("signature", "")
        signature = base64.b64decode(sig_b64)

        # Reconstruct the exact payload that was signed
        payload = _canonical_payload(token_dict)
        payload_bytes = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()

        pub_key = _load_private_key().public_key()
        pub_key.verify(signature, payload_bytes)
        return True
    except (InvalidSignature, Exception):
        return False


# ── Token generation ──────────────────────────────────────────────────────────

def generate_token(
    system_id: str,
    scopes: list[str] | None = None,
    expires_days: int = 365,
) -> dict:
    """Generate and sign a capability token for a monitored system.

    Returns a dict suitable for direct JSON serialisation and download.
    The probe loads this file verbatim from disk.
    """
    if scopes is None:
        scopes = DEFAULT_SCOPES

    # Validate scopes
    invalid = set(scopes) - VALID_SCOPES
    if invalid:
        raise ValueError(f"Unknown scopes: {invalid}. Valid: {VALID_SCOPES}")

    token_id  = str(uuid.uuid4())
    now       = int(time.time())
    expires   = now + (expires_days * 86_400)

    payload = _canonical_payload({
        "token_id":  token_id,
        "system_id": system_id,
        "scopes":    sorted(scopes),
        "issued_at": now,
        "expires_at": expires,
    })

    payload_bytes = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    signature_bytes = _load_private_key().sign(payload_bytes)

    backend_url = (
        os.environ.get("BACKEND_URL")
        or os.environ.get("RAILWAY_PUBLIC_DOMAIN")
        or "https://openwatch-backend-production.up.railway.app"
    )

    return {
        "token_id":            token_id,
        "system_id":           system_id,
        "scopes":              sorted(scopes),
        "issued_at":           now,
        "expires_at":          expires,
        "platform_url":        backend_url,
        "platform_public_key": get_platform_public_key_b64(),
        "signature":           base64.b64encode(signature_bytes).decode(),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _canonical_payload(token_dict: dict) -> dict:
    """Extract only the fields that are included in the signature.

    Separates the signable payload from decoration fields (platform_url,
    platform_public_key, signature itself) that must NOT be signed.
    """
    return {
        "token_id":   token_dict["token_id"],
        "system_id":  token_dict["system_id"],
        "scopes":     sorted(token_dict["scopes"]),
        "issued_at":  token_dict["issued_at"],
        "expires_at": token_dict["expires_at"],
    }


# ── CLI key generator ─────────────────────────────────────────────────────────

def _generate_and_print_keys() -> None:
    """Generate a fresh Ed25519 key pair and print Railway env var commands."""
    key     = Ed25519PrivateKey.generate()
    priv_b  = key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    pub_b   = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    priv_b64 = base64.b64encode(priv_b).decode()
    pub_b64  = base64.b64encode(pub_b).decode()

    print("\n── OpenWatch Platform Key Pair ─────────────────────────────────────")
    print("Set these as Railway environment variables on the backend service:\n")
    print(f"PLATFORM_PRIVATE_KEY_B64={priv_b64}")
    print(f"PLATFORM_PUBLIC_KEY_B64={pub_b64}")
    print("\nKeep PLATFORM_PRIVATE_KEY_B64 secret. Never commit it to git.")
    print("────────────────────────────────────────────────────────────────────\n")


if __name__ == "__main__":
    import sys
    if "--generate-keys" in sys.argv:
        _generate_and_print_keys()
    else:
        print("Usage: python -m core.token_issuer --generate-keys")
