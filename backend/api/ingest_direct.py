# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Direct ingest router — processes events synchronously without Kafka.
Used by the Railway lite backend (main_lite.py)."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, Request

from db.postgres_topology import UPSERT_HOST_PG, UPSERT_SERVICE_PG
from db.redis_client import SERVICE_KEY, SERVICE_TTL_SECONDS, SERVICES_SET
from models.events import AgentEvent
from models.metrics import INSERT_HEALTH

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["ingest"])


@router.post("/ingest", status_code=202)
async def ingest(event: AgentEvent, request: Request) -> dict:
    pool       = request.app.state.ts_pool
    redis      = request.app.state.redis
    ws_manager = request.app.state.ws_manager

    try:
        await _process_topology(pool, event)
        await _process_metrics(pool, event)
        await _process_livestate(redis, ws_manager, event)
    except Exception as exc:
        logger.error("ingest error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

    return {"accepted": True}


async def _process_topology(pool, event: AgentEvent) -> None:
    host_id = event.agent_id
    async with pool.acquire() as conn:
        await conn.execute(UPSERT_HOST_PG, host_id, event.hostname, "")
        for svc in event.services:
            await conn.execute(
                UPSERT_SERVICE_PG,
                svc.id, host_id, svc.name, svc.kind.value, svc.host, svc.port,
            )


async def _process_metrics(pool, event: AgentEvent) -> None:
    rows = [
        (
            event.timestamp,
            event.agent_id,
            event.hostname,
            svc.id,
            svc.name,
            svc.kind.value,
            svc.health.status.value if svc.health else None,
            svc.health.latency_ms   if svc.health else None,
            svc.health.message      if svc.health else None,
        )
        for svc in event.services
        if svc.health is not None
    ]
    if not rows:
        return
    async with pool.acquire() as conn:
        await conn.executemany(INSERT_HEALTH, rows)


async def _process_livestate(redis, ws_manager, event: AgentEvent) -> None:
    pipe = redis.pipeline()
    for svc in event.services:
        if svc.health is None:
            continue
        key = SERVICE_KEY.format(service_id=svc.id)
        pipe.hset(key, mapping={
            "service_id":    svc.id,
            "name":          svc.name,
            "kind":          svc.kind.value,
            "health_status": svc.health.status.value,
            "latency_ms":    svc.health.latency_ms or 0,
            "checked_at":    svc.health.checked_at.isoformat() if svc.health.checked_at else "",
        })
        pipe.expire(key, SERVICE_TTL_SECONDS)
        pipe.sadd(SERVICES_SET, svc.id)
    await pipe.execute()

    if ws_manager:
        try:
            from api.websocket import _build_snapshot
            snapshot = await _build_snapshot(redis)
            await ws_manager.broadcast(json.dumps(snapshot))
        except Exception as exc:
            logger.warning("ws broadcast failed: %s", exc)
