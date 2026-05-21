# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Probe authorizations — PostgreSQL table + queries.

Each row represents one capability token issued for a monitored system.
Revocation is a soft-delete (revoked_at timestamp). The probe registers
its host fingerprint on first contact, which is stored here for binding checks.
"""

from __future__ import annotations

import asyncpg

# ── DDL ───────────────────────────────────────────────────────────────────────

CREATE_PROBE_AUTHORIZATIONS = """
CREATE TABLE IF NOT EXISTS probe_authorizations (
    token_id         TEXT        PRIMARY KEY,
    system_id        TEXT        NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    scopes           TEXT[]      NOT NULL DEFAULT '{}',
    issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ NOT NULL,
    revoked_at       TIMESTAMPTZ,
    host_fingerprint TEXT,
    activated_at     TIMESTAMPTZ
)
"""

CREATE_PROBE_AUTHORIZATIONS_INDEX = """
CREATE INDEX IF NOT EXISTS idx_probe_auth_system_id
ON probe_authorizations(system_id)
"""

# ── Queries ───────────────────────────────────────────────────────────────────

INSERT_TOKEN = """
INSERT INTO probe_authorizations (token_id, system_id, scopes, expires_at)
VALUES ($1, $2, $3, $4)
"""

SELECT_TOKENS_FOR_SYSTEM = """
SELECT token_id, system_id, scopes, issued_at, expires_at,
       revoked_at, host_fingerprint, activated_at
FROM   probe_authorizations
WHERE  system_id = $1
ORDER BY issued_at DESC
"""

SELECT_TOKEN = """
SELECT token_id, system_id, scopes, issued_at, expires_at,
       revoked_at, host_fingerprint, activated_at
FROM   probe_authorizations
WHERE  token_id = $1
"""

REVOKE_TOKEN = """
UPDATE probe_authorizations
SET    revoked_at = NOW()
WHERE  token_id = $1
  AND  system_id = $2
  AND  revoked_at IS NULL
RETURNING token_id
"""

# Used by Component 2 (probe registration)
ACTIVATE_TOKEN = """
UPDATE probe_authorizations
SET    host_fingerprint = $2,
       activated_at     = NOW()
WHERE  token_id = $1
  AND  revoked_at IS NULL
  AND  activated_at IS NULL
RETURNING token_id
"""


# ── Init ──────────────────────────────────────────────────────────────────────

async def init_probe_tokens_table(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(CREATE_PROBE_AUTHORIZATIONS)
        await conn.execute(CREATE_PROBE_AUTHORIZATIONS_INDEX)
