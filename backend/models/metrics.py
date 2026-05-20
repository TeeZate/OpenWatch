# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""SQL queries for the service_health hypertable."""

# Bulk insert using executemany — one row per service per agent event.
INSERT_HEALTH = """
INSERT INTO service_health
    (time, agent_id, hostname, service_id, service_name, service_kind,
     health_status, latency_ms, message)
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9)
"""

# Latest health reading per service — used by the REST API live-state endpoint.
LATEST_PER_SERVICE = """
SELECT DISTINCT ON (service_id)
    time, service_id, service_name, service_kind,
    hostname, health_status, latency_ms, message
FROM service_health
ORDER BY service_id, time DESC
"""

# Time-series for a single service — used by the node detail panel.
SERVICE_HISTORY = """
SELECT time, health_status, latency_ms, message
FROM service_health
WHERE service_id = $1
  AND time > NOW() - $2::interval
ORDER BY time ASC
"""

# Uptime percentage over a window (fraction of "up" readings).
SERVICE_UPTIME = """
SELECT
    service_id,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE health_status = 'up') / COUNT(*),
        2
    ) AS uptime_pct
FROM service_health
WHERE time > NOW() - $1::interval
GROUP BY service_id
"""
