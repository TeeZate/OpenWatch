# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Railway-compatible entry point.
No Kafka, no Neo4j — uses plain PostgreSQL + Redis.
Set DATABASE_URL and REDIS_URL (or REDIS_PRIVATE_URL) in Railway environment."""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

# Load .env for local development (no-op in Railway where vars are set natively)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.health_api import router as health_router
from api.ingest_direct import router as ingest_router
from api.probe import router as probe_router
from api.risks import router as risks_router
from api.systems import router as systems_router
from api.tokens import router as tokens_router
from api.topology_pg import router as topology_router
from api.websocket import router as ws_router
from core.auth import APIKeyMiddleware
from core.connections import ConnectionManager
from core.probe_watcher import probe_watcher_loop
from core.prober import probe_loop
from db.postgres_topology import init_topology_tables
from db.probe_metrics_ts import init_probe_metrics_table
from db.probe_tokens import init_probe_tokens_table
from db.redis_client import create_redis
from db.systems import init_systems_table
from db.timescale import create_pool

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool       = await create_pool()
    redis      = create_redis()
    ws_manager = ConnectionManager()

    await init_topology_tables(pool)
    await init_systems_table(pool)
    await init_probe_tokens_table(pool)
    await init_probe_metrics_table(pool)

    app.state.ts_pool        = pool
    app.state.redis          = redis
    app.state.ws_manager     = ws_manager
    app.state.neo4j_driver   = None
    app.state.kafka_producer = None

    prober_task  = asyncio.create_task(probe_loop(app))
    watcher_task = asyncio.create_task(probe_watcher_loop(app))
    logger.info("OpenWatch Lite backend ready (Railway mode — no Kafka, no Neo4j)")
    yield

    prober_task.cancel()
    watcher_task.cancel()
    for task in (prober_task, watcher_task):
        try:
            await task
        except asyncio.CancelledError:
            pass
    await pool.close()
    await redis.aclose()
    logger.info("OpenWatch Lite shutdown complete")


app = FastAPI(
    title="OpenWatch Backend Lite",
    version="0.1.0",
    description="Railway-compatible build — PostgreSQL + Redis only",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────────────
# In production set DASHBOARD_URL to your Vercel/Railway dashboard origin.
# e.g. DASHBOARD_URL=https://openwatch.vercel.app
# Multiple origins can be comma-separated:
#   DASHBOARD_URL=https://openwatch.vercel.app,https://custom.domain.com
_raw_origins = os.getenv("DASHBOARD_URL", "")
if _raw_origins:
    _allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
else:
    # Dev fallback — allow localhost on any common port
    _allowed_origins = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=True,
)

# ── Dashboard API key auth ────────────────────────────────────────────────────
# Probe routes (HMAC) are exempt; all other management routes require X-OW-Key.
app.add_middleware(APIKeyMiddleware)

app.include_router(ingest_router)
app.include_router(probe_router)
app.include_router(topology_router)
app.include_router(health_router)
app.include_router(risks_router)
app.include_router(systems_router)
app.include_router(tokens_router)
app.include_router(ws_router)


@app.get("/health", tags=["system"])
def health() -> dict:
    return {"status": "ok", "service": "openwatch-backend-lite"}
