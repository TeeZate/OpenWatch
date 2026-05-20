# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

from __future__ import annotations

import logging

from fastapi import APIRouter, Header, HTTPException, Request

from models.events import AgentEvent
from stream.producer import TOPIC_AGENT_EVENTS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["ingest"])


@router.post("/ingest", status_code=202)
async def ingest_event(
    event: AgentEvent,
    request: Request,
    x_agent_id: str | None = Header(default=None),
) -> dict:
    """
    Receive an AgentEvent from a running agent and publish it to Kafka.
    The agent sends this every EMIT_INTERVAL seconds.
    """
    producer = request.app.state.kafka_producer

    try:
        await producer.send(
            TOPIC_AGENT_EVENTS,
            value=event.model_dump(mode="json"),
            key=event.agent_id,
        )
    except Exception as exc:
        logger.error("Failed to publish agent event agent_id=%s: %s", event.agent_id, exc)
        raise HTTPException(status_code=503, detail="Kafka unavailable — retry shortly")

    logger.info(
        "Ingested agent_id=%s hostname=%s services=%d",
        event.agent_id,
        event.hostname,
        len(event.services),
    )
    return {
        "accepted": True,
        "agent_id": event.agent_id,
        "hostname": event.hostname,
        "services_received": len(event.services),
    }
