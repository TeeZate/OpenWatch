# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

from __future__ import annotations

import json
import logging

from aiokafka import AIOKafkaProducer
from aiokafka.errors import KafkaConnectionError

logger = logging.getLogger(__name__)

TOPIC_AGENT_EVENTS = "agent.events"


class Producer:
    """Async Kafka producer. Call start() before use and stop() on shutdown."""

    def __init__(self, bootstrap_servers: str) -> None:
        self._bootstrap = bootstrap_servers
        self._producer: AIOKafkaProducer | None = None

    async def start(self) -> None:
        self._producer = AIOKafkaProducer(
            bootstrap_servers=self._bootstrap,
            value_serializer=lambda v: json.dumps(v, default=str).encode(),
            key_serializer=lambda k: k.encode() if k else None,
            # Guarantee at-least-once delivery
            acks="all",
            enable_idempotence=True,
        )
        await self._producer.start()
        logger.info("Kafka producer connected to %s", self._bootstrap)

    async def stop(self) -> None:
        if self._producer:
            await self._producer.stop()
            logger.info("Kafka producer stopped")

    async def send(self, topic: str, value: dict, key: str | None = None) -> None:
        if self._producer is None:
            raise RuntimeError("Producer not started — call start() first")
        try:
            await self._producer.send_and_wait(topic, value=value, key=key)
        except KafkaConnectionError as exc:
            logger.error("Kafka send failed (topic=%s key=%s): %s", topic, key, exc)
            raise
