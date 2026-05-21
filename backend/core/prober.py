# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Background prober — periodically probes all registered systems and writes
health results to Redis so the dashboard can display live status."""

from __future__ import annotations

import asyncio
import datetime
import logging
import time

import httpx

from db.redis_client import SERVICE_KEY, SERVICE_TTL_SECONDS, SERVICES_SET

logger = logging.getLogger(__name__)

PROBE_INTERVAL = 30  # seconds between full probe cycles
PROBE_TIMEOUT  = 10  # per-request timeout
PROBE_PATHS    = ["/health", "/healthz", "/api/health", "/api/v1/health", "/"]


async def _probe_url(url: str) -> dict:
    """Try health paths in order. Return first success; fall back to down."""
    base = url.rstrip("/")

    async with httpx.AsyncClient(
        timeout=PROBE_TIMEOUT,
        follow_redirects=True,
        verify=False,           # Railway self-signed certs sometimes appear
    ) as client:
        for path in PROBE_PATHS:
            target = base + path
            t0 = time.monotonic()
            try:
                resp = await client.get(target)
                latency_ms = (time.monotonic() - t0) * 1000
                if resp.status_code < 500:
                    status = "up" if resp.status_code < 400 else "degraded"
                    return {
                        "status":     status,
                        "latency_ms": round(latency_ms, 2),
                        "message":    f"HTTP {resp.status_code} {path}",
                    }
            except httpx.TimeoutException:
                pass
            except Exception:
                pass

    # All paths failed — one last attempt at the bare URL
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT, follow_redirects=True, verify=False) as client:
            resp = await client.get(base)
            latency_ms = (time.monotonic() - t0) * 1000
            status = "up" if resp.status_code < 400 else "degraded"
            return {"status": status, "latency_ms": round(latency_ms, 2), "message": f"HTTP {resp.status_code}"}
    except Exception as exc:
        latency_ms = (time.monotonic() - t0) * 1000
        return {"status": "down", "latency_ms": round(latency_ms, 2), "message": str(exc)[:120]}


async def probe_loop(app) -> None:
    """Long-running asyncio task. Probes every registered system every 30 s."""
    logger.info("Background prober started (interval=%ds)", PROBE_INTERVAL)
    while True:
        try:
            pool  = app.state.ts_pool
            redis = app.state.redis

            async with pool.acquire() as conn:
                rows = await conn.fetch("SELECT id, name, url FROM systems")

            if rows:
                logger.info("Probing %d system(s)…", len(rows))

            for row in rows:
                system_id = row["id"]
                result    = await _probe_url(row["url"])
                now       = datetime.datetime.now(datetime.timezone.utc).isoformat()

                key = SERVICE_KEY.format(service_id=system_id)
                await redis.hset(key, mapping={
                    "id":            system_id,
                    "service_id":    system_id,
                    "name":          row["name"],
                    "kind":          "http",
                    "host":          row["url"],
                    "port":          443,
                    "hostname":      row["url"],
                    "agent_id":      "openwatch-prober",
                    "health_status": result["status"],
                    "latency_ms":    result["latency_ms"],
                    "message":       result.get("message", ""),
                    "checked_at":    now,
                    "last_seen":     now,
                })
                # 20-min TTL — 4× longer than agent services so they survive agent restarts
                await redis.expire(key, SERVICE_TTL_SECONDS * 4)
                await redis.sadd(SERVICES_SET, system_id)

                logger.info(
                    "  %-30s %s  %.0f ms",
                    row["name"][:30], result["status"].upper(), result["latency_ms"]
                )

        except asyncio.CancelledError:
            logger.info("Background prober stopping")
            break
        except Exception as exc:
            logger.error("probe_loop error: %s", exc, exc_info=True)

        await asyncio.sleep(PROBE_INTERVAL)
