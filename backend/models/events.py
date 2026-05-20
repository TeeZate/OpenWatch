# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel


class ServiceKind(str, Enum):
    http = "http"
    postgres = "postgres"
    mysql = "mysql"
    mongodb = "mongodb"
    redis = "redis"
    kafka = "kafka"
    rabbitmq = "rabbitmq"
    elasticsearch = "elasticsearch"
    tcp = "tcp"


class HealthStatus(str, Enum):
    up = "up"
    degraded = "degraded"
    down = "down"


class ProbeResult(BaseModel):
    service_id: str
    status: HealthStatus
    latency_ms: float
    message: Optional[str] = None
    checked_at: datetime


class Service(BaseModel):
    id: str
    name: str
    kind: ServiceKind
    host: str
    port: int
    pid: Optional[int] = None
    binary: Optional[str] = None
    cmdline: Optional[str] = None
    health: Optional[ProbeResult] = None


class AgentEvent(BaseModel):
    agent_id: str
    hostname: str
    timestamp: datetime
    services: list[Service]
