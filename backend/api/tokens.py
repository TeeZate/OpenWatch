# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Probe capability token API.

POST   /api/v1/systems/{system_id}/token          — issue a new token
GET    /api/v1/systems/{system_id}/tokens         — list all tokens for a system
DELETE /api/v1/systems/{system_id}/token/{token_id} — revoke a token
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from core.token_issuer import DEFAULT_SCOPES, VALID_SCOPES, generate_token
from db.probe_tokens import (
    INSERT_TOKEN,
    REVOKE_TOKEN,
    SELECT_TOKEN,
    SELECT_TOKENS_FOR_SYSTEM,
)
from db.redis_client import PROBE_REVOKED_SET, PROBE_TOKEN_KEY

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["probe-tokens"])


# ── Request / response models ─────────────────────────────────────────────────

class CreateTokenRequest(BaseModel):
    scopes:       list[str] = DEFAULT_SCOPES
    expires_days: int        = 365

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, v: list[str]) -> list[str]:
        invalid = set(v) - VALID_SCOPES
        if invalid:
            raise ValueError(f"Unknown scopes: {invalid}")
        if not v:
            raise ValueError("At least one scope is required")
        return v

    @field_validator("expires_days")
    @classmethod
    def validate_expiry(cls, v: int) -> int:
        if not (1 <= v <= 730):
            raise ValueError("expires_days must be between 1 and 730")
        return v


class TokenSummary(BaseModel):
    token_id:        str
    system_id:       str
    scopes:          list[str]
    issued_at:       str
    expires_at:      str
    revoked:         bool
    activated:       bool
    host_fingerprint: Optional[str] = None


# ── POST /api/v1/systems/{system_id}/token ────────────────────────────────────

@router.post("/systems/{system_id}/token", status_code=201)
async def create_token(
    system_id: str,
    body: CreateTokenRequest,
    request: Request,
) -> dict:
    """Issue a new capability token for a monitored system.

    Returns the complete token dict, ready to be written to token.json on the
    probe host. The token is signed with the platform's Ed25519 private key and
    stored in both PostgreSQL (audit log) and Redis (fast revocation checks).
    """
    pool  = request.app.state.ts_pool
    redis = request.app.state.redis

    # ── Verify system exists ──────────────────────────────────────────────────
    async with pool.acquire() as conn:
        system = await conn.fetchrow(
            "SELECT id, name FROM systems WHERE id = $1", system_id
        )
    if system is None:
        raise HTTPException(status_code=404, detail="System not found")

    # ── Generate + sign token ─────────────────────────────────────────────────
    try:
        token = generate_token(
            system_id=system_id,
            scopes=body.scopes,
            expires_days=body.expires_days,
        )
    except Exception as exc:
        logger.error("Token generation failed: %s", exc)
        raise HTTPException(status_code=500, detail="Token generation failed") from exc

    expires_dt = datetime.fromtimestamp(token["expires_at"], tz=timezone.utc)

    # ── Persist to PostgreSQL ─────────────────────────────────────────────────
    async with pool.acquire() as conn:
        await conn.execute(
            INSERT_TOKEN,
            token["token_id"],
            system_id,
            token["scopes"],
            expires_dt,
        )

    # ── Cache in Redis for fast revocation + fingerprint checks ──────────────
    token_ttl = token["expires_at"] - int(time.time())
    if token_ttl > 0:
        redis_key = PROBE_TOKEN_KEY.format(token_id=token["token_id"])
        await redis.hset(redis_key, mapping={
            "system_id":       system_id,
            "scopes":          ",".join(token["scopes"]),
            "issued_at":       str(token["issued_at"]),
            "expires_at":      str(token["expires_at"]),
            "revoked":         "0",
            "host_fingerprint": "",
        })
        await redis.expire(redis_key, token_ttl)

    logger.info(
        "Token %s issued for system %s (%s) — scopes: %s, expires: %s",
        token["token_id"], system["name"], system_id,
        token["scopes"], expires_dt.isoformat()
    )

    return {
        "message": "Token issued successfully.",
        "system_name": system["name"],
        "token": token,
    }


# ── GET /api/v1/systems/{system_id}/tokens ────────────────────────────────────

@router.get("/systems/{system_id}/tokens", response_model=list[TokenSummary])
async def list_tokens(system_id: str, request: Request) -> list[TokenSummary]:
    """List all capability tokens for a system (active, revoked, and expired)."""
    pool = request.app.state.ts_pool

    async with pool.acquire() as conn:
        system = await conn.fetchrow("SELECT id FROM systems WHERE id = $1", system_id)
        if system is None:
            raise HTTPException(status_code=404, detail="System not found")

        rows = await conn.fetch(SELECT_TOKENS_FOR_SYSTEM, system_id)

    return [
        TokenSummary(
            token_id=row["token_id"],
            system_id=row["system_id"],
            scopes=list(row["scopes"]),
            issued_at=row["issued_at"].isoformat(),
            expires_at=row["expires_at"].isoformat(),
            revoked=row["revoked_at"] is not None,
            activated=row["activated_at"] is not None,
            host_fingerprint=row["host_fingerprint"],
        )
        for row in rows
    ]


# ── DELETE /api/v1/systems/{system_id}/token/{token_id} ──────────────────────

@router.delete("/systems/{system_id}/token/{token_id}", status_code=200)
async def revoke_token(
    system_id: str,
    token_id: str,
    request: Request,
) -> dict:
    """Revoke a capability token immediately.

    The token is soft-deleted in PostgreSQL and added to the Redis revocation
    set. The probe will receive a 401 on its next push (within 30 seconds) and
    stop transmitting.
    """
    pool  = request.app.state.ts_pool
    redis = request.app.state.redis

    # ── Soft-delete in Postgres ───────────────────────────────────────────────
    async with pool.acquire() as conn:
        row = await conn.fetchrow(REVOKE_TOKEN, token_id, system_id)

    if row is None:
        # Either token doesn't exist, wrong system, or already revoked
        async with pool.acquire() as conn:
            existing = await conn.fetchrow(SELECT_TOKEN, token_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Token not found")
        if existing["revoked_at"] is not None:
            raise HTTPException(status_code=409, detail="Token is already revoked")
        raise HTTPException(status_code=403, detail="Token does not belong to this system")

    # ── Add to Redis revocation set (fast O(1) check on every ingest) ─────────
    await redis.sadd(PROBE_REVOKED_SET, token_id)

    # ── Update Redis hash to mark revoked ─────────────────────────────────────
    redis_key = PROBE_TOKEN_KEY.format(token_id=token_id)
    await redis.hset(redis_key, "revoked", "1")

    logger.info("Token %s revoked for system %s", token_id, system_id)

    return {
        "revoked": token_id,
        "message": "Token revoked. The probe will stop transmitting within 30 seconds.",
    }
