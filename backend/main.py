# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from api.health_api import router as health_router
from api.ingest import router as ingest_router
from api.risks import router as risks_router
from api.topology import router as topology_router
from api.websocket import router as ws_router
from core.connections import ConnectionManager
from db.redis_client import create_redis
from db.timescale import create_pool
from stream.intelligence_consumer import IntelligenceConsumer
from stream.livestate_consumer import LiveStateConsumer
from stream.metrics_consumer import MetricsConsumer
from stream.producer import Producer
from stream.topology_consumer import TopologyConsumer, create_neo4j_driver

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    kafka_servers = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")

    producer     = Producer(bootstrap_servers=kafka_servers)
    neo4j_driver = create_neo4j_driver()
    ts_pool      = await create_pool()
    redis        = create_redis()
    ws_manager   = ConnectionManager()

    await producer.start()

    app.state.kafka_producer = producer
    app.state.neo4j_driver   = neo4j_driver
    app.state.ts_pool        = ts_pool
    app.state.redis          = redis
    app.state.ws_manager     = ws_manager

    tasks = [
        asyncio.create_task(
            TopologyConsumer(kafka_servers, neo4j_driver).run(),
            name="topology-consumer",
        ),
        asyncio.create_task(
            MetricsConsumer(kafka_servers, ts_pool).run(),
            name="metrics-consumer",
        ),
        asyncio.create_task(
            LiveStateConsumer(kafka_servers, redis, ws_manager).run(),
            name="livestate-consumer",
        ),
        asyncio.create_task(
            IntelligenceConsumer(kafka_servers, redis, neo4j_driver).run(),
            name="intelligence-consumer",
        ),
    ]

    logger.info("OpenWatch backend ready — 4 consumers running")
    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)

    await producer.stop()
    await neo4j_driver.close()
    await ts_pool.close()
    await redis.aclose()
    logger.info("OpenWatch backend shutdown complete")


app = FastAPI(
    title="OpenWatch Backend",
    version="0.1.0",
    description="System health monitoring — ingestion and intelligence API",
    lifespan=lifespan,
)

app.include_router(ingest_router)
app.include_router(topology_router)
app.include_router(health_router)
app.include_router(risks_router)
app.include_router(ws_router)


@app.get("/health", tags=["system"])
def health() -> dict:
    return {"status": "ok", "service": "openwatch-backend"}
