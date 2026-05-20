# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

from __future__ import annotations

import asyncio
import json
import logging
import os

from aiokafka import AIOKafkaConsumer
from neo4j import AsyncDriver, AsyncGraphDatabase

from models.events import AgentEvent
from models.topology import UPSERT_HOST, UPSERT_SERVICE
from stream.producer import TOPIC_AGENT_EVENTS

logger = logging.getLogger(__name__)

CONSUMER_GROUP = "openwatch-topology"


class TopologyConsumer:
    """
    Consumes agent.events from Kafka and writes the topology into Neo4j.
    Each AgentEvent becomes a set of Host + Service nodes with RUNS edges.
    """

    def __init__(self, bootstrap_servers: str, neo4j_driver: AsyncDriver) -> None:
        self._bootstrap = bootstrap_servers
        self._driver = neo4j_driver
        self._consumer: AIOKafkaConsumer | None = None

    async def run(self) -> None:
        """Main loop — starts the consumer and processes messages until cancelled."""
        self._consumer = AIOKafkaConsumer(
            TOPIC_AGENT_EVENTS,
            bootstrap_servers=self._bootstrap,
            group_id=CONSUMER_GROUP,
            auto_offset_reset="earliest",
            value_deserializer=lambda b: json.loads(b.decode()),
            enable_auto_commit=True,
        )
        await self._consumer.start()
        logger.info("TopologyConsumer started (group=%s topic=%s)", CONSUMER_GROUP, TOPIC_AGENT_EVENTS)

        try:
            async for msg in self._consumer:
                await self._handle(msg.value)
        except asyncio.CancelledError:
            logger.info("TopologyConsumer shutting down")
        finally:
            await self._consumer.stop()

    async def _handle(self, raw: dict) -> None:
        try:
            event = AgentEvent.model_validate(raw)
        except Exception as exc:
            logger.warning("Topology: invalid event payload: %s", exc)
            return

        try:
            await self._write_topology(event)
            logger.debug(
                "Topology updated agent_id=%s services=%d",
                event.agent_id,
                len(event.services),
            )
        except Exception as exc:
            logger.error("Topology: Neo4j write failed: %s", exc)

    async def _write_topology(self, event: AgentEvent) -> None:
        async with self._driver.session() as session:
            # 1. Upsert the host node
            await session.run(
                UPSERT_HOST,
                hostname=event.hostname,
                agent_id=event.agent_id,
                last_seen=event.timestamp.isoformat(),
            )

            # 2. Upsert each service node and link to host
            for svc in event.services:
                health_status = None
                latency_ms = None
                if svc.health:
                    health_status = svc.health.status.value
                    latency_ms = svc.health.latency_ms

                await session.run(
                    UPSERT_SERVICE,
                    id=svc.id,
                    name=svc.name,
                    kind=svc.kind.value,
                    host=svc.host,
                    port=svc.port,
                    pid=svc.pid,
                    binary=svc.binary or "",
                    health_status=health_status,
                    latency_ms=latency_ms,
                    last_seen=event.timestamp.isoformat(),
                    hostname=event.hostname,
                )


def create_neo4j_driver() -> AsyncDriver:
    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "openwatch123")
    return AsyncGraphDatabase.driver(uri, auth=(user, password))
