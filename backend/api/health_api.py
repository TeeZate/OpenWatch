# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query, Request

from db.redis_client import SERVICE_KEY, SERVICES_SET
from models.metrics import SERVICE_HISTORY, SERVICE_UPTIME
from models.responses import (
    HealthHistoryResponse,
    HealthPoint,
    HealthSummary,
    LiveHealthResponse,
    ServiceLiveState,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["health"])


@router.get("/health/live", response_model=LiveHealthResponse)
async def get_live_health(request: Request) -> LiveHealthResponse:
    """
    Return the current health state of every known service, read from Redis.
    Sub-millisecond reads — this is the hot path for the dashboard.
    """
    redis = request.app.state.redis

    service_ids: set[str] = await redis.smembers(SERVICES_SET)
    if not service_ids:
        return LiveHealthResponse(
            services=[],
            summary=HealthSummary(total=0, up=0, degraded=0, down=0, unknown=0),
            generated_at=datetime.now(timezone.utc),
        )

    # Fetch all hashes in one pipeline round-trip
    pipe = redis.pipeline(transaction=False)
    for sid in service_ids:
        pipe.hgetall(SERVICE_KEY.format(service_id=sid))
    raw_states = await pipe.execute()

    services: list[ServiceLiveState] = []
    counts = {"up": 0, "degraded": 0, "down": 0, "unknown": 0}

    for raw in raw_states:
        if not raw:
            continue
        latency = raw.get("latency_ms")
        last_seen = raw.get("last_seen")
        status = raw.get("health_status") or "unknown"
        counts[status if status in counts else "unknown"] += 1

        services.append(ServiceLiveState(
            id=raw.get("id", ""),
            name=raw.get("name", ""),
            kind=raw.get("kind", ""),
            host=raw.get("host", ""),
            port=int(raw.get("port", 0)),
            hostname=raw.get("hostname", ""),
            agent_id=raw.get("agent_id", ""),
            health_status=status,
            latency_ms=float(latency) if latency else None,
            message=raw.get("message") or None,
            last_seen=datetime.fromisoformat(last_seen) if last_seen else None,
        ))

    # Sort: down first, then degraded, then up — most urgent at top
    _order = {"down": 0, "degraded": 1, "up": 2, "unknown": 3}
    services.sort(key=lambda s: _order.get(s.health_status or "unknown", 3))

    return LiveHealthResponse(
        services=services,
        summary=HealthSummary(total=len(services), **counts),
        generated_at=datetime.now(timezone.utc),
    )


@router.get("/health/history/{service_id}", response_model=HealthHistoryResponse)
async def get_health_history(
    service_id: str,
    request: Request,
    window: str = Query(default="1 hour", description="TimescaleDB interval, e.g. '1 hour', '24 hours', '7 days'"),
) -> HealthHistoryResponse:
    """
    Return the time-series health history for one service from TimescaleDB.
    Use the window parameter to control the lookback period.
    """
    pool = request.app.state.ts_pool

    async with pool.acquire() as conn:
        rows = await conn.fetch(SERVICE_HISTORY, service_id, window)

    points = [
        HealthPoint(
            time=row["time"],
            health_status=row["health_status"],
            latency_ms=row["latency_ms"],
            message=row["message"],
        )
        for row in rows
    ]

    return HealthHistoryResponse(
        service_id=service_id,
        window=window,
        points=points,
    )


@router.get("/health/uptime")
async def get_uptime(
    request: Request,
    window: str = Query(default="24 hours"),
) -> dict:
    """Return uptime percentage per service over the given window."""
    pool = request.app.state.ts_pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(SERVICE_UPTIME, window)
    return {
        "window": window,
        "uptime": {row["service_id"]: row["uptime_pct"] for row in rows},
    }
