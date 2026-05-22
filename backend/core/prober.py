# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Background prober — periodically probes all registered systems, parses their
health endpoint responses to discover sub-service topology, and writes results
to Redis so the dashboard can render a live architecture view."""

from __future__ import annotations

import asyncio
import datetime
import json
import logging
import time
from typing import Optional

import httpx

from db.redis_client import (
    SERVICE_KEY, SERVICE_TTL_SECONDS, SERVICES_SET, SYSTEM_TOPO_KEY
)

logger = logging.getLogger(__name__)

PROBE_INTERVAL = 30   # seconds between full probe cycles
PROBE_TIMEOUT  = 10   # per-request timeout in seconds
PROBE_PATHS    = ["/health", "/healthz", "/api/health", "/api/v1/health", "/"]


# ── Status normalisation ───────────────────────────────────────────────────────

def _normalize_status(raw: str) -> str:
    s = str(raw).lower().strip()
    if s in ("ok", "up", "healthy", "online", "pass", "true", "1", "success",
             "available", "running", "alive", "reachable"):
        return "up"
    if s in ("degraded", "warn", "warning", "slow", "partial", "unstable"):
        return "degraded"
    if s in ("down", "error", "fail", "failing", "failed", "unhealthy",
             "offline", "false", "0", "critical", "unavailable", "unreachable"):
        return "down"
    return "unknown"


def _infer_kind(name: str) -> str:
    """Guess the service kind from its check name."""
    n = name.lower()
    if any(x in n for x in ("postgres", "pg", "mysql", "mariadb", "sqlite",
                              "cockroach", "aurora", "rds", "neon", "supabase")):
        return "database"
    if any(x in n for x in ("mongo", "mongodb", "atlas", "document")):
        return "mongodb"
    if any(x in n for x in ("redis", "cache", "memcache", "dragonfly")):
        return "redis"
    if any(x in n for x in ("kafka", "rabbit", "rabbitmq", "sqs", "pubsub", "queue", "bull")):
        return "kafka"
    if any(x in n for x in ("stripe", "payment", "braintree", "paypal", "adyen")):
        return "payment"
    if any(x in n for x in ("s3", "storage", "blob", "minio", "gcs", "r2")):
        return "storage"
    if any(x in n for x in ("elastic", "opensearch", "search", "typesense", "algolia")):
        return "elasticsearch"
    if any(x in n for x in ("mail", "smtp", "ses", "sendgrid", "mailgun", "postmark")):
        return "email"
    if any(x in n for x in ("db", "database")):
        return "database"
    return "http"


def _parse_health_topology(body: dict) -> list[dict]:
    """
    Extract sub-service checks from a health response JSON.

    Handles common formats:
    • NestJS Terminus:  { "info": { "db": { "status": "up" } }, "details": {...} }
    • Spring Boot:      { "components": { "db": { "status": "UP" } } }
    • Custom checks:    { "checks": { "redis": { "status": "ok", "latency": 2 } } }
    • Generic services: { "services": { "stripe": { "healthy": true } } }
    • Flat status map:  { "database": "ok", "cache": "ok" }
    """
    checks: list[dict] = []
    seen: set[str] = set()

    # Priority sections — richer detail sections take precedence
    section_keys = ["details", "info", "checks", "services", "components",
                    "dependencies", "subsystems", "integrations"]

    for key in section_keys:
        section = body.get(key)
        if not isinstance(section, dict):
            continue
        for name, val in section.items():
            if name in seen:
                continue
            seen.add(name)
            if isinstance(val, dict):
                # Extract status
                status_raw = (
                    val.get("status") or val.get("health") or
                    val.get("state") or val.get("healthy") or "unknown"
                )
                # Extract latency (many naming conventions)
                latency = (
                    val.get("responseTime") or val.get("response_time") or
                    val.get("latency_ms") or val.get("latency") or
                    val.get("duration_ms") or val.get("ping")
                )
                # Extract message/error
                message = (
                    val.get("message") or val.get("error") or
                    val.get("reason") or val.get("details")
                )
                if isinstance(message, dict):
                    message = None  # nested object, skip
                checks.append({
                    "name":       name,
                    "status":     _normalize_status(str(status_raw)),
                    "latency_ms": round(float(latency), 2) if latency is not None else None,
                    "message":    str(message)[:120] if message else None,
                    "kind":       _infer_kind(name),
                })
            elif isinstance(val, (str, bool)):
                # Flat: { "database": "ok" }
                seen.add(name)
                checks.append({
                    "name":       name,
                    "status":     _normalize_status(str(val)),
                    "latency_ms": None,
                    "message":    None,
                    "kind":       _infer_kind(name),
                })

    return checks


# ── HTTP prober ────────────────────────────────────────────────────────────────

async def _probe_url(url: str) -> dict:
    """
    Try health paths in order.
    Returns: { status, latency_ms, message, path, body_json }
    """
    base = url.rstrip("/")

    async with httpx.AsyncClient(
        timeout=PROBE_TIMEOUT,
        follow_redirects=True,
        verify=False,
    ) as client:
        for path in PROBE_PATHS:
            target = base + path
            t0 = time.monotonic()
            try:
                resp = await client.get(target)
                latency_ms = round((time.monotonic() - t0) * 1000, 2)

                if resp.status_code < 500:
                    status = "up" if resp.status_code < 400 else "degraded"

                    # Try to parse JSON for topology
                    body_json: Optional[dict] = None
                    try:
                        if "json" in resp.headers.get("content-type", ""):
                            body_json = resp.json()
                    except Exception:
                        pass

                    return {
                        "status":     status,
                        "latency_ms": latency_ms,
                        "message":    f"HTTP {resp.status_code} {path}",
                        "path":       path,
                        "body_json":  body_json,
                    }
            except httpx.TimeoutException:
                pass
            except Exception:
                pass

    # All named paths failed — last attempt at bare URL
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(
            timeout=PROBE_TIMEOUT, follow_redirects=True, verify=False
        ) as client:
            resp = await client.get(base)
            latency_ms = round((time.monotonic() - t0) * 1000, 2)
            status = "up" if resp.status_code < 400 else "degraded"
            body_json = None
            try:
                if "json" in resp.headers.get("content-type", ""):
                    body_json = resp.json()
            except Exception:
                pass
            return {
                "status":     status,
                "latency_ms": latency_ms,
                "message":    f"HTTP {resp.status_code}",
                "path":       "/",
                "body_json":  body_json,
            }
    except Exception as exc:
        latency_ms = round((time.monotonic() - t0) * 1000, 2)
        return {
            "status":     "down",
            "latency_ms": latency_ms,
            "message":    str(exc)[:120],
            "path":       None,
            "body_json":  None,
        }


# ── Main loop ──────────────────────────────────────────────────────────────────

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

                # ── Store live health state ────────────────────────────────────
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
                await redis.expire(key, SERVICE_TTL_SECONDS * 4)
                await redis.sadd(SERVICES_SET, system_id)

                # ── Parse & store topology ─────────────────────────────────────
                # IMPORTANT: if a probe agent has already written rich sub_services
                # (probe_source=True), preserve them — do not overwrite with the
                # sparse data from the HTTP health check endpoint.  The prober only
                # owns latency, status and path; the probe agent owns sub_services.
                topo_key = SYSTEM_TOPO_KEY.format(system_id=system_id)

                existing_raw = await redis.get(topo_key)
                existing: dict = {}
                if existing_raw:
                    try:
                        existing = json.loads(existing_raw)
                    except Exception:
                        pass

                if existing.get("probe_source"):
                    # Probe agent is the authority for sub_services — keep them.
                    sub_services = existing.get("sub_services", [])
                else:
                    # No probe connected — use whatever the health endpoint returns.
                    sub_services = []
                    if isinstance(result.get("body_json"), dict):
                        sub_services = _parse_health_topology(result["body_json"])

                topo_payload = json.dumps({
                    "system_id":    system_id,
                    "name":         row["name"],
                    "url":          row["url"],
                    "status":       result["status"],
                    "latency_ms":   result["latency_ms"],
                    "message":      result.get("message"),
                    "path":         result.get("path"),
                    "sub_services": sub_services,
                    "probe_source": existing.get("probe_source", False),
                    "updated_at":   now,
                })
                await redis.set(topo_key, topo_payload, ex=SERVICE_TTL_SECONDS * 4)

                logger.info(
                    "  %-30s %-8s %5.0f ms  %d sub-service(s)",
                    row["name"][:30],
                    result["status"].upper(),
                    result["latency_ms"],
                    len(sub_services),
                )

        except asyncio.CancelledError:
            logger.info("Background prober stopping")
            break
        except Exception as exc:
            logger.error("probe_loop error: %s", exc, exc_info=True)

        await asyncio.sleep(PROBE_INTERVAL)
