# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Async Redis client factory."""

from __future__ import annotations

import logging
import os

from redis.asyncio import Redis

logger = logging.getLogger(__name__)

# Key schema
SERVICE_KEY      = "service:{service_id}"          # HASH  — live state per service
SERVICES_SET     = "services:all"                  # SET   — all known service IDs
HOST_KEY         = "host:{hostname}"               # HASH  — live state per host
HOSTS_SET        = "hosts:all"                     # SET   — all known hostnames
RISKS_KEY        = "risks:latest"                  # STRING — latest AI risk summary (JSON)
SYSTEM_TOPO_KEY  = "system_topo:{system_id}"      # STRING — JSON topology for monitored system
PROBE_TOKEN_KEY   = "probe_token:{token_id}"      # HASH   — live token state (revocation + fingerprint)
PROBE_REVOKED_SET = "probe_revoked"               # SET    — token_ids that have been revoked (O(1) check)
PROBE_SEQ_KEY     = "probe_seq:{system_id}"       # STRING — last accepted sequence number (replay protection)
PROBE_METRICS_KEY   = "probe_metrics:{system_id}"    # STRING — JSON OS/network metrics from probe (TTL: 120 s)
PROBE_EXTENDED_KEY  = "probe_extended:{system_id}"  # STRING — JSON schema/endpoints/synthetics (TTL: 10 min)

# 5 minutes — if the agent stops reporting, stale keys expire on their own.
SERVICE_TTL_SECONDS = 300


def create_redis() -> Redis:
    url = (
        os.environ.get("REDIS_URL")
        or os.environ.get("REDIS_PRIVATE_URL")
        or "redis://localhost:6379"
    )
    client = Redis.from_url(url, decode_responses=True)
    logger.info("Redis client created (%s)", url)
    return client
