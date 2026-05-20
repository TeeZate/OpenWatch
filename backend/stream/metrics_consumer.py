# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

from __future__ import annotations

import asyncio
import json
import logging

import asyncpg
from aiokafka import AIOKafkaConsumer

from models.events import AgentEvent
from models.metrics import INSERT_HEALTH
from stream.producer import TOPIC_AGENT_EVENTS

logger = logging.getLogger(__name__)

CONSUMER_GROUP = "openwatch-metrics"


class MetricsConsumer:
    """
    Consumes agent.events from Kafka and writes time-series health rows
    into the TimescaleDB service_health hypertable.

    Runs in the same Kafka topic as the topology consumer but uses a
    separate consumer group so both receive every message independently.
    """

    def __init__(self, bootstrap_servers: str, pool: asyncpg.Pool) -> None:
        self._bootstrap = bootstrap_servers
        self._pool = pool
        self._consumer: AIOKafkaConsumer | None = None

    async def run(self) -> None:
        self._consumer = AIOKafkaConsumer(
            TOPIC_AGENT_EVENTS,
            bootstrap_servers=self._bootstrap,
            group_id=CONSUMER_GROUP,
            auto_offset_reset="earliest",
            value_deserializer=lambda b: json.loads(b.decode()),
            enable_auto_commit=True,
        )
        await self._consumer.start()
        logger.info("MetricsConsumer started (group=%s topic=%s)", CONSUMER_GROUP, TOPIC_AGENT_EVENTS)

        try:
            async for msg in self._consumer:
                await self._handle(msg.value)
        except asyncio.CancelledError:
            logger.info("MetricsConsumer shutting down")
        finally:
            await self._consumer.stop()

    async def _handle(self, raw: dict) -> None:
        try:
            event = AgentEvent.model_validate(raw)
        except Exception as exc:
            logger.warning("Metrics: invalid event payload: %s", exc)
            return

        rows = _build_rows(event)
        if not rows:
            return

        try:
            async with self._pool.acquire() as conn:
                await conn.executemany(INSERT_HEALTH, rows)
            logger.debug(
                "Metrics: inserted %d rows agent_id=%s", len(rows), event.agent_id
            )
        except Exception as exc:
            logger.error("Metrics: TimescaleDB write failed: %s", exc)


def _build_rows(event: AgentEvent) -> list[tuple]:
    """Convert an AgentEvent into a list of INSERT_HEALTH parameter tuples."""
    rows = []
    for svc in event.services:
        health_status = None
        latency_ms = None
        message = None
        if svc.health:
            health_status = svc.health.status.value
            latency_ms = svc.health.latency_ms
            message = svc.health.message

        rows.append((
            event.timestamp,       # $1 time
            event.agent_id,        # $2 agent_id
            event.hostname,        # $3 hostname
            svc.id,                # $4 service_id
            svc.name,              # $5 service_name
            svc.kind.value,        # $6 service_kind
            health_status,         # $7 health_status
            latency_ms,            # $8 latency_ms
            message,               # $9 message
        ))
    return rows
