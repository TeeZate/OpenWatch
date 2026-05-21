# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Systems registry — stores explicitly monitored remote systems."""

from __future__ import annotations

import asyncpg

CREATE_SYSTEMS = """
CREATE TABLE IF NOT EXISTS systems (
    id         TEXT        PRIMARY KEY,
    name       TEXT        NOT NULL,
    url        TEXT        NOT NULL UNIQUE,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
"""

INSERT_SYSTEM = """
INSERT INTO systems (id, name, url)
VALUES ($1, $2, $3)
ON CONFLICT (url) DO NOTHING
RETURNING id
"""

SELECT_ALL_SYSTEMS = """
SELECT id, name, url, added_at
FROM systems
ORDER BY added_at ASC
"""

COUNT_SYSTEMS = "SELECT COUNT(*) FROM systems"

DELETE_SYSTEM = "DELETE FROM systems WHERE id = $1 RETURNING id"


async def init_systems_table(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(CREATE_SYSTEMS)
