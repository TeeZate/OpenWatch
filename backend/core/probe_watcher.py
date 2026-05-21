# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Probe liveness watcher — background task.

Runs every 60 seconds. For each system that has ever had a probe connected,
checks whether probe_metrics:{system_id} still exists in Redis (TTL: 120 s,
reset on every ingest). When a system transitions connected→disconnected:

  1. Updates service:{system_id} hash: probe_connected = "0"
  2. Broadcasts a WebSocket health_update event so the dashboard reflects
     the disconnect in real time without waiting for the next poll cycle.
  3. Logs a WARNING so Railway logs capture the event.

The in-memory `_prev` dict only tracks systems that have been seen as
connected at least once — systems that never had a probe are ignored.
"""

from __future__ import annotations

import asyncio
import datetime
import json
import logging

from db.redis_client import PROBE_METRICS_KEY, SERVICE_KEY

logger = logging.getLogger(__name__)

CHECK_INTERVAL = 60  # seconds between watcher sweeps


async def probe_watcher_loop(app) -> None:
    """Entry point — run as an asyncio task from main_lite.py lifespan."""
    prev_connected: dict[str, bool] = {}

    while True:
        await asyncio.sleep(CHECK_INTERVAL)
        try:
            await _check_all(app, prev_connected)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Probe watcher sweep error: %s", exc)


async def _check_all(app, prev_connected: dict[str, bool]) -> None:
    pool       = app.state.ts_pool
    redis      = app.state.redis
    ws_manager = app.state.ws_manager

    # Fetch all system IDs registered in Postgres
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id FROM systems")

    system_ids = [row["id"] for row in rows]

    for system_id in system_ids:
        metrics_key  = PROBE_METRICS_KEY.format(system_id=system_id)
        is_connected = bool(await redis.exists(metrics_key))

        was_connected = prev_connected.get(system_id)

        if was_connected is True and not is_connected:
            # ── Transition: connected → disconnected ──────────────────────────
            logger.warning(
                "Probe disconnected: system=%s — no push received in >120 s",
                system_id,
            )

            # Update live state key so REST status endpoint reflects this
            svc_key = SERVICE_KEY.format(service_id=system_id)
            await redis.hset(svc_key, mapping={
                "probe_connected": "0",
                "probe_last_seen": prev_connected.get(f"_last_seen:{system_id}", ""),
            })

            # Broadcast to all dashboard WebSocket clients
            if ws_manager:
                event = {
                    "type":            "health_update",
                    "source":          "probe_watcher",
                    "system_id":       system_id,
                    "probe_connected": False,
                    "timestamp":       datetime.datetime.now(
                        datetime.timezone.utc
                    ).isoformat(),
                }
                try:
                    await ws_manager.broadcast(json.dumps(event))
                except Exception as exc:
                    logger.debug("WebSocket broadcast failed in watcher: %s", exc)

        # Track last seen time while connected
        if is_connected:
            prev_connected[f"_last_seen:{system_id}"] = (
                datetime.datetime.now(datetime.timezone.utc).isoformat()
            )

        prev_connected[system_id] = is_connected
