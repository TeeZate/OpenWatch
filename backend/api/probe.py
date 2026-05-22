# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Probe ingest API.

POST /api/v1/probe/register          — first-time probe activation + fingerprint binding
POST /api/v1/ingest/{system_id}      — recurring signed telemetry push
GET  /api/v1/probe/ca.crt            — download the platform CA certificate (public)
"""

from __future__ import annotations

import datetime
import json
import logging
import time

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from core.cert_authority import get_ca_cert_pem, verify_client_cert
from core.probe_validator import validate_probe_payload
from db.probe_metrics_ts import INSERT_PROBE_METRICS, SELECT_PROBE_METRICS_HISTORY
from db.probe_tokens import ACTIVATE_TOKEN, SELECT_TOKEN
from db.redis_client import (
    PROBE_EXTENDED_KEY,
    PROBE_METRICS_KEY,
    PROBE_REVOKED_SET,
    PROBE_SEQ_KEY,
    PROBE_TOKEN_KEY,
    SERVICE_KEY,
    SYSTEM_TOPO_KEY,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["probe-ingest"])


# ── Request models ────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    token_id:         str
    system_id:        str
    host_fingerprint: str
    probe_version:    str = "unknown"
    hostname:         str = ""


# ── GET /api/v1/probe/ca.crt ─────────────────────────────────────────────────

@router.get("/probe/ca.crt", include_in_schema=False)
async def get_ca_cert():
    """Serve the platform CA certificate (PEM). Safe to download — public key only."""
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(get_ca_cert_pem(), media_type="application/x-pem-file")


# ── GET /api/v1/systems/{system_id}/probe/status ─────────────────────────────

@router.get("/systems/{system_id}/probe/status")
async def get_probe_status(system_id: str, request: Request) -> dict:
    """Return current probe connection state and latest OS/network metrics.

    Returns connected=false if no telemetry has been received in the last 120s
    (the Redis TTL set on probe_metrics). This gives the dashboard a reliable
    liveness signal without a separate heartbeat mechanism.
    """
    redis = request.app.state.redis

    metrics_raw = await redis.get(PROBE_METRICS_KEY.format(system_id=system_id))
    seq_raw     = await redis.get(PROBE_SEQ_KEY.format(system_id=system_id))

    if metrics_raw is None:
        return {"connected": False, "last_seen": None, "sequence": None,
                "os": {}, "network": {}, "processes": [], "topology": {}}

    try:
        metrics = json.loads(metrics_raw)
    except Exception:
        metrics = {}

    return {
        "connected":  True,
        "last_seen":  metrics.get("updated_at"),
        "sequence":   int(seq_raw) if seq_raw else 0,
        "os":         metrics.get("os", {}),
        "network":    metrics.get("network", {}),
        "processes":  metrics.get("processes", []),
        "topology":   metrics.get("topology", {}),
    }


# ── GET /api/v1/systems/{system_id}/probe/extended ──────────────────────────

@router.get("/systems/{system_id}/probe/extended")
async def get_probe_extended(system_id: str, request: Request) -> dict:
    """Return the latest extended probe data: database schema, API endpoints, synthetics.

    This data is collected every ~5 minutes by the probe (every 10th push cycle)
    and stored with a 10-minute TTL. Returns empty dicts/lists if not yet collected.
    """
    redis = request.app.state.redis
    raw   = await redis.get(PROBE_EXTENDED_KEY.format(system_id=system_id))
    if raw is None:
        return {"database": None, "api_schema": None, "synthetics": []}
    try:
        return json.loads(raw)
    except Exception:
        return {"database": None, "api_schema": None, "synthetics": []}


# ── GET /api/v1/systems/{system_id}/probe/metrics/history ────────────────────

@router.get("/systems/{system_id}/probe/metrics/history")
async def get_probe_metrics_history(
    system_id: str,
    request:   Request,
    window:    str = "1h",
) -> list[dict]:
    """Return OS metric snapshots for the given time window.

    window examples: '30m', '1h', '3h', '6h', '24h'
    Returns up to 360 rows (one per 30-second push cycle, ~3 hours at full rate).
    """
    valid_windows = {"30m", "1h", "3h", "6h", "12h", "24h"}
    if window not in valid_windows:
        window = "1h"

    pool = request.app.state.ts_pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(SELECT_PROBE_METRICS_HISTORY, system_id, window)

    return [
        {
            "time":          row["time"].isoformat(),
            "cpu_pct":       row["cpu_pct"],
            "mem_used_pct":  row["mem_used_pct"],
            "mem_used_mb":   row["mem_used_mb"],
            "disk_used_pct": row["disk_used_pct"],
            "load_1m":       row["load_1m"],
            "bytes_in_ps":   row["bytes_in_ps"],
            "bytes_out_ps":  row["bytes_out_ps"],
            "connections":   row["connections"],
        }
        for row in rows
    ]


# ── POST /api/v1/probe/register ───────────────────────────────────────────────

@router.post("/probe/register", status_code=200)
async def register_probe(
    body: RegisterRequest,
    request: Request,
    x_openwatch_client_cert: str | None = Header(default=None),
) -> dict:
    """First-time probe registration.

    The probe calls this endpoint once on startup with its host fingerprint.
    The platform binds the fingerprint to the token — subsequent pushes from
    a different machine will be rejected (Check 4 in the validation pipeline).

    If the token is already activated (fingerprint already bound), this returns
    409 unless the same fingerprint is presented again (idempotent re-register).
    """
    pool  = request.app.state.ts_pool
    redis = request.app.state.redis

    token_id         = body.token_id
    system_id        = body.system_id
    host_fingerprint = body.host_fingerprint.strip()

    if not host_fingerprint:
        raise HTTPException(status_code=422, detail="host_fingerprint is required")

    # ── Client cert check (soft — log if missing) ─────────────────────────────
    if x_openwatch_client_cert:
        cert_ok, cert_token_id = verify_client_cert(x_openwatch_client_cert)
        if not cert_ok:
            raise HTTPException(status_code=401, detail="Client certificate invalid")
        if cert_token_id != token_id:
            raise HTTPException(status_code=401, detail="Certificate CN does not match token_id")
    else:
        logger.warning("Probe registration for token %s sent no client cert.", token_id)

    # ── Check token is valid and not revoked ──────────────────────────────────
    is_revoked = await redis.sismember(PROBE_REVOKED_SET, token_id)
    if is_revoked:
        raise HTTPException(status_code=401, detail="Token has been revoked")

    redis_key  = PROBE_TOKEN_KEY.format(token_id=token_id)
    token_data = await redis.hgetall(redis_key)
    if not token_data:
        raise HTTPException(status_code=401, detail="Token not found or expired")
    if token_data.get("system_id") != system_id:
        raise HTTPException(status_code=403, detail="Token does not belong to this system")

    # ── Check if already activated ────────────────────────────────────────────
    stored_fp = token_data.get("host_fingerprint", "")
    if stored_fp:
        if stored_fp == host_fingerprint:
            # Idempotent — same machine re-registering (e.g. after restart)
            logger.info(
                "Probe re-registered for system %s (token %s) — same fingerprint.",
                system_id, token_id
            )
            return {
                "registered": True,
                "status":     "already_active",
                "system_id":  system_id,
                "message":    "Probe already registered with this fingerprint.",
            }
        else:
            # Different machine — reject
            raise HTTPException(
                status_code=409,
                detail=(
                    "Token is already bound to a different host. "
                    "Revoke this token and issue a new one to re-register."
                ),
            )

    # ── Bind fingerprint in Redis ─────────────────────────────────────────────
    await redis.hset(redis_key, "host_fingerprint", host_fingerprint)

    # ── Bind fingerprint + mark activated in PostgreSQL ───────────────────────
    async with pool.acquire() as conn:
        activated = await conn.fetchrow(ACTIVATE_TOKEN, token_id, host_fingerprint)

    if activated is None:
        # Race condition: another request activated it between our checks — treat as ok
        logger.warning("ACTIVATE_TOKEN returned no row for token %s — may be a race.", token_id)

    logger.info(
        "Probe registered: system=%s token=%s host=%s version=%s",
        system_id, token_id, body.hostname or "unknown", body.probe_version,
    )

    return {
        "registered": True,
        "status":     "activated",
        "system_id":  system_id,
        "message":    "Host fingerprint bound. Probe is authorized to push telemetry.",
    }


# ── POST /api/v1/ingest/{system_id} ──────────────────────────────────────────

@router.post("/ingest/{system_id}", status_code=202)
async def ingest_probe_payload(
    system_id: str,
    request:   Request,
    x_openwatch_signature:    str | None = Header(default=None),
    x_openwatch_client_cert:  str | None = Header(default=None),
) -> dict:
    """Receive a signed telemetry payload from an authorized probe.

    The 6-step validation pipeline runs before any data is written.
    On success, Redis is updated and a WebSocket event is broadcast.
    """
    redis      = request.app.state.redis
    ws_manager = request.app.state.ws_manager

    # ── Parse body ────────────────────────────────────────────────────────────
    # Read raw bytes first — they are passed to the HMAC verifier so the
    # signature is checked against the exact bytes the probe signed, not a
    # re-serialised dict (which would differ in key order).
    raw_body = await request.body()
    try:
        payload = json.loads(raw_body)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid JSON body")

    # ── Validation pipeline ───────────────────────────────────────────────────
    valid, error = await validate_probe_payload(
        system_id=system_id,
        payload=payload,
        raw_body=raw_body,
        signature_header=x_openwatch_signature,
        client_cert_header=x_openwatch_client_cert,
        redis=redis,
    )
    if not valid:
        logger.warning("Probe ingest rejected for system %s: %s", system_id, error)
        raise HTTPException(status_code=401, detail=error)

    # ── Write data to Redis + Postgres time-series ───────────────────────────
    pool = request.app.state.ts_pool
    await _write_probe_data(system_id, payload, redis)
    await _write_metrics_history(system_id, payload, pool)

    # ── Broadcast WebSocket event ─────────────────────────────────────────────
    if ws_manager:
        try:
            services    = payload.get("services", [])
            health_status = _infer_overall_status(services)
            event = {
                "type":            "health_update",
                "source":          "probe",
                "system_id":       system_id,
                "health_status":   health_status,
                "probe_connected": True,
                "timestamp":       datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }
            await ws_manager.broadcast(json.dumps(event))
        except Exception as exc:
            logger.warning("WebSocket broadcast failed: %s", exc)

    logger.info(
        "Probe ingest accepted: system=%s seq=%s services=%d",
        system_id,
        payload.get("sequence", "?"),
        len(payload.get("services", [])),
    )

    return {"accepted": True, "system_id": system_id}


# ── Data writer ───────────────────────────────────────────────────────────────

async def _write_probe_data(system_id: str, payload: dict, redis) -> None:
    """Write all probe telemetry fields to Redis atomically."""
    now        = datetime.datetime.now(datetime.timezone.utc).isoformat()
    token_id   = payload.get("token_id", "")
    sequence   = int(payload.get("sequence", 0))
    services   = payload.get("services", [])
    health_status = _infer_overall_status(services)

    pipe = redis.pipeline()

    # ── 1. Update live health state for this system ───────────────────────────
    svc_key = SERVICE_KEY.format(service_id=system_id)
    pipe.hset(svc_key, mapping={
        "health_status":   health_status,
        "probe_connected": "1",
        "probe_last_seen": now,
        "checked_at":      now,
        "last_seen":       now,
    })

    # ── 2. Merge sub-services into topology cache ─────────────────────────────
    # We fetch the existing topo first (outside the pipeline) then update it
    topo_key = SYSTEM_TOPO_KEY.format(system_id=system_id)

    # ── 3. Store OS + network + process metrics ───────────────────────────────
    metrics_key = PROBE_METRICS_KEY.format(system_id=system_id)
    probe_metrics = {
        "os":          payload.get("os", {}),
        "network":     payload.get("network", {}),
        "processes":   payload.get("processes", []),
        "topology":    payload.get("topology", {}),
        "updated_at":  now,
    }
    pipe.set(metrics_key, json.dumps(probe_metrics), ex=120)

    # ── 4. Advance sequence number ────────────────────────────────────────────
    seq_key = PROBE_SEQ_KEY.format(system_id=system_id)
    pipe.set(seq_key, str(sequence), ex=604_800)  # 7-day TTL

    # ── 5. Update token last_seen ─────────────────────────────────────────────
    if token_id:
        token_key = PROBE_TOKEN_KEY.format(token_id=token_id)
        pipe.hset(token_key, "last_seen", now)

    await pipe.execute()

    # ── 6. Store extended data if present (DB schema, API endpoints, synthetics)
    extended: dict = {}
    if payload.get("database")     is not None: extended["database"]      = payload["database"]
    if payload.get("api_schema")   is not None: extended["api_schema"]    = payload["api_schema"]
    if payload.get("synthetics")   is not None: extended["synthetics"]    = payload["synthetics"]
    if payload.get("architecture") is not None: extended["architecture"]  = payload["architecture"]
    if extended:
        ext_key = PROBE_EXTENDED_KEY.format(system_id=system_id)
        extended["updated_at"] = now
        await redis.set(ext_key, json.dumps(extended), ex=600)  # 10-minute TTL

    # ── 7. Merge sub-services into existing topology (separate read-modify-write)
    topo_raw = await redis.get(topo_key)
    topo: dict = {}
    if topo_raw:
        try:
            topo = json.loads(topo_raw)
        except Exception:
            pass

    # Merge synthetic checks into sub_services so they appear in the topology graph
    synthetic_svcs = []
    for syn in payload.get("synthetics", []):
        synthetic_svcs.append({
            "name":       syn.get("name", syn.get("url", "frontend")),
            "kind":       "http",
            "status":     syn.get("status", "unknown"),
            "latency_ms": syn.get("latency_ms"),
            "message":    syn.get("error") or (f"HTTP {syn['status_code']}" if syn.get("status_code") else None),
        })

    all_services = services + synthetic_svcs
    topo["sub_services"]  = all_services
    topo["probe_source"]  = True
    topo["health_status"] = _infer_overall_status(all_services)
    topo["updated_at"]    = now
    await redis.set(topo_key, json.dumps(topo), ex=120)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _write_metrics_history(system_id: str, payload: dict, pool) -> None:
    """Persist one OS+network snapshot row to the probe_os_metrics hypertable."""
    try:
        os_m  = payload.get("os",      {})
        net_m = payload.get("network", {})
        seq   = int(payload.get("sequence", 0))

        async with pool.acquire() as conn:
            await conn.execute(
                INSERT_PROBE_METRICS,
                system_id,
                os_m.get("cpu_pct"),
                os_m.get("mem_used_pct"),
                os_m.get("mem_used_mb"),
                os_m.get("mem_total_mb"),
                os_m.get("disk_used_pct"),
                os_m.get("load_1m"),
                net_m.get("bytes_in_ps"),
                net_m.get("bytes_out_ps"),
                net_m.get("connections"),
                seq,
            )
    except Exception as exc:
        # Non-fatal — Redis live state is already written, don't fail the ingest
        logger.warning("Failed to write metrics history for system %s: %s", system_id, exc)


def _infer_overall_status(services: list[dict]) -> str:
    """Derive an overall health status from a list of service check results."""
    if not services:
        return "up"
    statuses = [s.get("status", "unknown") for s in services]
    if "down" in statuses:
        return "down"
    if "degraded" in statuses:
        return "degraded"
    if all(s == "up" for s in statuses):
        return "up"
    return "degraded"
