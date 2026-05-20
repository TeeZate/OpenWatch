# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from db.redis_client import SERVICE_KEY, SERVICES_SET

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/live")
async def ws_live(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for real-time health updates.

    Protocol:
      → connect
      ← immediate "snapshot" message with current full state (from Redis)
      ← "health_update" message on every agent event processed
      → disconnect (any time)

    Message shape:
      { "type": "snapshot" | "health_update",
        "services": [...],
        "summary": { "total", "up", "degraded", "down", "unknown" },
        "timestamp": "<ISO>" }
    """
    manager = websocket.app.state.ws_manager
    redis   = websocket.app.state.redis

    await manager.connect(websocket)

    try:
        # Send current state immediately so the dashboard doesn't wait 30 s
        snapshot = await _build_snapshot(redis)
        snapshot["type"] = "snapshot"
        await websocket.send_json(snapshot)

        # Keep the connection alive; all further messages are server-push via broadcast.
        # We still need to receive frames to detect client disconnects.
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)


async def _build_snapshot(redis) -> dict:
    """Read current service states from Redis and format as a broadcast message."""
    service_ids: set[str] = await redis.smembers(SERVICES_SET)
    if not service_ids:
        return _empty_snapshot()

    pipe = redis.pipeline(transaction=False)
    for sid in service_ids:
        pipe.hgetall(SERVICE_KEY.format(service_id=sid))
    raw_states = await pipe.execute()

    services = []
    counts = {"up": 0, "degraded": 0, "down": 0, "unknown": 0}

    for raw in raw_states:
        if not raw:
            continue
        status = raw.get("health_status") or "unknown"
        counts[status if status in counts else "unknown"] += 1

        latency = raw.get("latency_ms")
        services.append({
            "id":            raw.get("id", ""),
            "name":          raw.get("name", ""),
            "kind":          raw.get("kind", ""),
            "host":          raw.get("host", ""),
            "port":          int(raw.get("port", 0)),
            "hostname":      raw.get("hostname", ""),
            "agent_id":      raw.get("agent_id", ""),
            "health_status": status,
            "latency_ms":    float(latency) if latency else None,
            "message":       raw.get("message") or None,
            "last_seen":     raw.get("last_seen"),
        })

    _order = {"down": 0, "degraded": 1, "up": 2, "unknown": 3}
    services.sort(key=lambda s: _order.get(s["health_status"], 3))

    return {
        "services": services,
        "summary": {"total": len(services), **counts},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _empty_snapshot() -> dict:
    return {
        "services": [],
        "summary": {"total": 0, "up": 0, "degraded": 0, "down": 0, "unknown": 0},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
