# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""probe_os_metrics time-series table.

Stores one row per probe push (every ~30 seconds) with OS and network
snapshot data. Used to render sparkline charts in the dashboard.

TimescaleDB hypertable is created automatically when the extension is
available; falls back silently to a plain PostgreSQL table otherwise.
"""

from __future__ import annotations

import asyncpg

# ── DDL ───────────────────────────────────────────────────────────────────────

CREATE_PROBE_METRICS = """
CREATE TABLE IF NOT EXISTS probe_os_metrics (
    time          TIMESTAMPTZ      NOT NULL,
    system_id     TEXT             NOT NULL,
    cpu_pct       DOUBLE PRECISION,
    mem_used_pct  DOUBLE PRECISION,
    mem_used_mb   BIGINT,
    mem_total_mb  BIGINT,
    disk_used_pct DOUBLE PRECISION,
    load_1m       DOUBLE PRECISION,
    bytes_in_ps   DOUBLE PRECISION,
    bytes_out_ps  DOUBLE PRECISION,
    connections   INTEGER,
    sequence      BIGINT
)
"""

CREATE_PROBE_METRICS_INDEX = """
CREATE INDEX IF NOT EXISTS idx_probe_os_metrics_system_time
ON probe_os_metrics (system_id, time DESC)
"""

HYPERTABLE_SQL = """
SELECT create_hypertable(
    'probe_os_metrics', 'time',
    if_not_exists => TRUE,
    migrate_data  => TRUE
)
"""

# ── Queries ───────────────────────────────────────────────────────────────────

INSERT_PROBE_METRICS = """
INSERT INTO probe_os_metrics
    (time, system_id, cpu_pct, mem_used_pct, mem_used_mb, mem_total_mb,
     disk_used_pct, load_1m, bytes_in_ps, bytes_out_ps, connections, sequence)
VALUES
    (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
"""

SELECT_PROBE_METRICS_HISTORY = """
SELECT time, cpu_pct, mem_used_pct, mem_used_mb, disk_used_pct,
       load_1m, bytes_in_ps, bytes_out_ps, connections
FROM   probe_os_metrics
WHERE  system_id = $1
  AND  time > NOW() - $2::interval
ORDER BY time ASC
LIMIT  360
"""


# ── Init ──────────────────────────────────────────────────────────────────────

async def init_probe_metrics_table(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(CREATE_PROBE_METRICS)
        await conn.execute(CREATE_PROBE_METRICS_INDEX)
        try:
            await conn.execute(HYPERTABLE_SQL)
        except Exception:
            pass  # TimescaleDB extension not available — plain table is fine
