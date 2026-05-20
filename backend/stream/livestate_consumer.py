# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

from __future__ import annotations

import asyncio
import json
import logging

from aiokafka import AIOKafkaConsumer
from redis.asyncio import Redis

from core.connections import ConnectionManager
from db.redis_client import (
    HOST_KEY,
    HOSTS_SET,
    SERVICE_KEY,
    SERVICE_TTL_SECONDS,
    SERVICES_SET,
)
from models.events import AgentEvent
from stream.producer import TOPIC_AGENT_EVENTS

logger = logging.getLogger(__name__)

CONSUMER_GROUP = "openwatch-livestate"


class LiveStateConsumer:
    """
    Consumes agent.events and keeps Redis up-to-date with the current health
    state of every service.

    Redis layout
    ────────────
    HASH  service:{id}   → name, kind, host, port, hostname, agent_id,
                           health_status, latency_ms, message, last_seen
    SET   services:all   → all service IDs seen (union across all agents)

    HASH  host:{hostname} → agent_id, service_count, last_seen
    SET   hosts:all       → all hostnames seen

    All service keys carry a 5-minute TTL so stale data ages out automatically.
    After each write, broadcasts the updated state to all WebSocket clients.
    """

    def __init__(
        self,
        bootstrap_servers: str,
        redis: Redis,
        ws_manager: ConnectionManager | None = None,
    ) -> None:
        self._bootstrap = bootstrap_servers
        self._redis = redis
        self._ws_manager = ws_manager
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
        logger.info(
            "LiveStateConsumer started (group=%s topic=%s)",
            CONSUMER_GROUP,
            TOPIC_AGENT_EVENTS,
        )

        try:
            async for msg in self._consumer:
                await self._handle(msg.value)
        except asyncio.CancelledError:
            logger.info("LiveStateConsumer shutting down")
        finally:
            await self._consumer.stop()

    async def _handle(self, raw: dict) -> None:
        try:
            event = AgentEvent.model_validate(raw)
        except Exception as exc:
            logger.warning("LiveState: invalid event payload: %s", exc)
            return

        try:
            await self._write_state(event)
            logger.debug(
                "LiveState: updated %d services agent_id=%s",
                len(event.services),
                event.agent_id,
            )
        except Exception as exc:
            logger.error("LiveState: Redis write failed: %s", exc)
            return

        # Broadcast to WebSocket clients after a successful Redis write
        if self._ws_manager and self._ws_manager.client_count > 0:
            try:
                from api.websocket import _build_snapshot  # avoid circular import at module level
                payload = await _build_snapshot(self._redis)
                payload["type"] = "health_update"
                await self._ws_manager.broadcast(payload)
            except Exception as exc:
                logger.warning("LiveState: WS broadcast failed: %s", exc)

    async def _write_state(self, event: AgentEvent) -> None:
        pipe = self._redis.pipeline(transaction=False)

        for svc in event.services:
            key = SERVICE_KEY.format(service_id=svc.id)

            health_status = ""
            latency_ms = ""
            message = ""
            if svc.health:
                health_status = svc.health.status.value
                latency_ms    = str(svc.health.latency_ms)
                message       = svc.health.message or ""

            pipe.hset(key, mapping={
                "id":            svc.id,
                "name":          svc.name,
                "kind":          svc.kind.value,
                "host":          svc.host,
                "port":          str(svc.port),
                "hostname":      event.hostname,
                "agent_id":      event.agent_id,
                "health_status": health_status,
                "latency_ms":    latency_ms,
                "message":       message,
                "last_seen":     event.timestamp.isoformat(),
            })
            # Refresh TTL on every update — key expires if agent goes silent
            pipe.expire(key, SERVICE_TTL_SECONDS)
            pipe.sadd(SERVICES_SET, svc.id)

        # Update host summary
        host_key = HOST_KEY.format(hostname=event.hostname)
        pipe.hset(host_key, mapping={
            "hostname":      event.hostname,
            "agent_id":      event.agent_id,
            "service_count": str(len(event.services)),
            "last_seen":     event.timestamp.isoformat(),
        })
        pipe.expire(host_key, SERVICE_TTL_SECONDS)
        pipe.sadd(HOSTS_SET, event.hostname)

        await pipe.execute()
