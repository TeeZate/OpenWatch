# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Topology storage in plain PostgreSQL (used by Railway lite backend)."""

from __future__ import annotations

import asyncpg

CREATE_HOSTS = """
CREATE TABLE IF NOT EXISTS hosts (
    host_id   TEXT        PRIMARY KEY,
    hostname  TEXT        NOT NULL,
    ip        TEXT        NOT NULL DEFAULT '',
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
"""

CREATE_SERVICES_TOPO = """
CREATE TABLE IF NOT EXISTS services_topo (
    service_id TEXT        PRIMARY KEY,
    host_id    TEXT        NOT NULL REFERENCES hosts(host_id) ON DELETE CASCADE,
    name       TEXT        NOT NULL DEFAULT '',
    kind       TEXT        NOT NULL DEFAULT 'tcp',
    host       TEXT        NOT NULL DEFAULT '',
    port       INT         NOT NULL DEFAULT 0,
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
"""

UPSERT_HOST_PG = """
INSERT INTO hosts (host_id, hostname, ip, last_seen)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (host_id) DO UPDATE
    SET hostname  = EXCLUDED.hostname,
        ip        = EXCLUDED.ip,
        last_seen = NOW()
"""

UPSERT_SERVICE_PG = """
INSERT INTO services_topo (service_id, host_id, name, kind, host, port, last_seen)
VALUES ($1, $2, $3, $4, $5, $6, NOW())
ON CONFLICT (service_id) DO UPDATE
    SET name      = EXCLUDED.name,
        kind      = EXCLUDED.kind,
        host      = EXCLUDED.host,
        port      = EXCLUDED.port,
        last_seen = NOW()
"""

FETCH_TOPOLOGY_PG = """
SELECT s.service_id, s.host_id, s.name, s.kind, s.host, s.port, h.hostname
FROM   services_topo s
JOIN   hosts h ON s.host_id = h.host_id
WHERE  s.last_seen > NOW() - INTERVAL '10 minutes'
"""


async def init_topology_tables(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(CREATE_HOSTS)
        await conn.execute(CREATE_SERVICES_TOPO)
