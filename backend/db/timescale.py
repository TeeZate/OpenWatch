# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""
Async connection pool for TimescaleDB (PostgreSQL + TimescaleDB extension).
Handles pool creation, schema initialisation, and graceful shutdown.
"""

from __future__ import annotations

import logging
import os

import asyncpg

logger = logging.getLogger(__name__)

_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS service_health (
    time          TIMESTAMPTZ      NOT NULL,
    agent_id      TEXT             NOT NULL,
    hostname      TEXT             NOT NULL,
    service_id    TEXT             NOT NULL,
    service_name  TEXT             NOT NULL,
    service_kind  TEXT             NOT NULL,
    health_status TEXT,
    latency_ms    DOUBLE PRECISION,
    message       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sh_service_id ON service_health (service_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_sh_hostname   ON service_health (hostname, time DESC);
"""

_HYPERTABLE_SQL = """
SELECT create_hypertable(
    'service_health', 'time',
    if_not_exists => TRUE,
    migrate_data  => TRUE
);
"""


async def create_pool() -> asyncpg.Pool:
    dsn = (
        os.environ.get("TIMESCALEDB_URL")
        or os.environ.get("DATABASE_URL")
        or os.environ.get("POSTGRES_URL")
        or "postgresql://openwatch:openwatch@localhost:5432/openwatch_metrics"
    )
    pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)
    await _init_schema(pool)
    logger.info("PostgreSQL pool ready")
    return pool


async def _init_schema(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(_TABLE_SQL)
        try:
            await conn.execute(_HYPERTABLE_SQL)
            logger.info("TimescaleDB hypertable ready")
        except Exception:
            logger.info("TimescaleDB extension not available — using plain PostgreSQL table")
