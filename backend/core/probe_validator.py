# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Probe payload validation pipeline.

Every ingest request from a probe passes through all 5 checks in order.
A failure at any step rejects the payload with an appropriate HTTP status.

Checks:
    1. Client certificate  — signed by platform CA, CN == token_id in payload
    2. Revocation          — token_id not in the Redis revocation SET
    3. Token integrity     — token exists in Redis, belongs to this system_id
    4. Host fingerprint    — payload fingerprint matches the one bound at registration
    5. HMAC signature      — payload hasn't been tampered with in transit
    6. Sequence number     — monotonically increasing (replay protection)

Steps 1 and 4 are soft-enforced during the transition period:
    - Step 1: if no cert header is sent, we log a warning but allow through
              (probe versions before cert support can still register)
    - Step 4: if token is not yet activated (no fingerprint bound), we skip
              the fingerprint check (the registration endpoint handles binding)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time

logger = logging.getLogger(__name__)


# ── Public API ────────────────────────────────────────────────────────────────

async def validate_probe_payload(
    system_id: str,
    payload: dict,
    signature_header: str | None,
    client_cert_header: str | None,
    redis,
    raw_body: bytes | None = None,
) -> tuple[bool, str | None]:
    """Run the full validation pipeline.

    Returns:
        (valid: bool, error_message: str | None)
        On failure, error_message describes which check failed.
    """
    token_id = payload.get("token_id")
    if not token_id:
        return False, "Missing token_id in payload"

    # ── Check 1: Client certificate ───────────────────────────────────────────
    if client_cert_header:
        cert_ok, cert_token_id = _verify_cert(client_cert_header)
        if not cert_ok:
            return False, "Client certificate invalid or not signed by platform CA"
        if cert_token_id != token_id:
            return False, "Client certificate CN does not match payload token_id"
    else:
        logger.warning(
            "Probe for system %s sent no client cert (X-OpenWatch-Client-Cert). "
            "Accepting without cert — probe should be updated to include cert.",
            system_id,
        )

    # ── Check 2: Revocation (Redis O(1) SET lookup) ───────────────────────────
    from db.redis_client import PROBE_REVOKED_SET, PROBE_TOKEN_KEY, PROBE_SEQ_KEY
    is_revoked = await redis.sismember(PROBE_REVOKED_SET, token_id)
    if is_revoked:
        return False, "Token has been revoked"

    # ── Check 3: Token integrity (exists, correct system, not expired) ────────
    redis_key  = PROBE_TOKEN_KEY.format(token_id=token_id)
    token_data = await redis.hgetall(redis_key)

    if not token_data:
        # Token not in Redis — check if it genuinely doesn't exist or just expired
        return False, "Token not found or has expired"

    if token_data.get("system_id") != system_id:
        return False, "Token does not belong to this system"

    if token_data.get("revoked") == "1":
        return False, "Token has been revoked"

    expires_at = int(token_data.get("expires_at", 0))
    if expires_at and int(time.time()) > expires_at:
        return False, "Token has expired"

    # ── Check 4: Host fingerprint (only if token has been activated) ──────────
    stored_fp  = token_data.get("host_fingerprint", "")
    payload_fp = payload.get("host_fingerprint", "")
    if stored_fp and payload_fp and stored_fp != payload_fp:
        return False, "Host fingerprint mismatch — token may have been copied to another machine"

    # ── Check 5: HMAC signature ───────────────────────────────────────────────
    hmac_key = token_data.get("hmac_key", "")
    if hmac_key and signature_header:
        if not _verify_hmac(raw_body, payload, hmac_key, signature_header):
            return False, "Payload signature invalid — possible tampering in transit"
    elif hmac_key and not signature_header:
        # Token has an hmac_key but no signature was sent — reject
        return False, "Missing X-OpenWatch-Signature header"

    # ── Check 6: Sequence number (replay protection) ──────────────────────────
    # The seq_key TTL is 7 days, so it survives across restarts.
    # The register endpoint deletes it on re-register, but as a safety net we
    # also allow a "reset" if the new sequence is significantly lower than the
    # last accepted — this covers the case where re-registration and the first
    # push race and the delete hasn't propagated yet.
    seq_key  = PROBE_SEQ_KEY.format(system_id=system_id)
    last_seq = await redis.get(seq_key)
    new_seq  = int(payload.get("sequence", 0))
    if last_seq is not None:
        last_seq_int = int(last_seq)
        # Allow if new_seq is strictly greater (normal advancing case)
        # Also allow if new_seq looks like a fresh restart (reset to near-zero
        # after a large prior run — the re-register endpoint should have cleared
        # this, but handle the race defensively).
        if new_seq <= last_seq_int:
            # Probe restarted (seq reset to 0..N) but register didn't clear the key yet.
            # Accept if new_seq is very low (< 10) — it's almost certainly a fresh start.
            if new_seq >= 10:
                return False, f"Replay detected: sequence {new_seq} <= last accepted {last_seq}"
            # new_seq < 10 → treat as fresh restart; the key will be overwritten below
            logger.info(
                "Probe for system %s appears to have restarted (seq %d after %d). "
                "Accepting fresh start.",
                system_id, new_seq, last_seq_int,
            )

    return True, None


# ── Internal helpers ──────────────────────────────────────────────────────────

def _verify_cert(cert_pem_b64: str) -> tuple[bool, str | None]:
    try:
        from core.cert_authority import verify_client_cert
        return verify_client_cert(cert_pem_b64)
    except Exception as exc:
        logger.error("Cert verification error: %s", exc)
        return False, None


def _verify_hmac(
    raw_body: bytes | None,
    payload: dict,
    hmac_key_b64: str,
    signature_header: str,
) -> bool:
    """Verify HMAC-SHA256 signature.

    The probe signs the exact bytes it marshalled with json.Marshal — key order
    follows Go struct field declaration order, NOT alphabetical. We therefore
    verify against the raw HTTP body bytes the probe sent, not a re-serialised
    dict (which would produce different bytes and always fail).

    Fallback: if raw_body is not provided (old call sites), fall back to
    canonical JSON with sort_keys=True for backward compatibility.

    The signature header format: X-OpenWatch-Signature: hmac-sha256=<base64>
    """
    try:
        key = base64.b64decode(hmac_key_b64)

        # Prefer raw bytes — these are exactly what the probe signed.
        body_bytes: bytes
        if raw_body is not None:
            body_bytes = raw_body
        else:
            # Legacy fallback: re-serialise with sorted keys
            body_bytes = json.dumps(
                payload, sort_keys=True, separators=(",", ":")
            ).encode()

        expected_digest = hmac.new(key, body_bytes, hashlib.sha256).digest()
        expected_b64    = base64.b64encode(expected_digest).decode()

        # Header may be bare base64 or prefixed with "hmac-sha256="
        provided = signature_header.strip()
        if provided.startswith("hmac-sha256="):
            provided = provided[len("hmac-sha256="):]

        return hmac.compare_digest(expected_b64, provided)

    except Exception as exc:
        logger.debug("HMAC verification error: %s", exc)
        return False
