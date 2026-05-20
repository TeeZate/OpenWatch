# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Pydantic response models for the REST API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


# ── Topology ──────────────────────────────────────────────────────────────────

class CytoscapeNodeData(BaseModel):
    id: str
    label: str
    type: str                        # "host" | "service"
    kind: Optional[str] = None       # service kind (redis, postgres, …)
    status: Optional[str] = None     # health_status
    latency_ms: Optional[float] = None
    port: Optional[int] = None
    hostname: Optional[str] = None


class CytoscapeEdgeData(BaseModel):
    id: str
    source: str
    target: str


class CytoscapeNode(BaseModel):
    data: CytoscapeNodeData


class CytoscapeEdge(BaseModel):
    data: CytoscapeEdgeData


class TopologyResponse(BaseModel):
    nodes: list[CytoscapeNode]
    edges: list[CytoscapeEdge]
    generated_at: datetime


# ── Live health ───────────────────────────────────────────────────────────────

class ServiceLiveState(BaseModel):
    id: str
    name: str
    kind: str
    host: str
    port: int
    hostname: str
    agent_id: str
    health_status: Optional[str] = None
    latency_ms: Optional[float] = None
    message: Optional[str] = None
    last_seen: Optional[datetime] = None


class HealthSummary(BaseModel):
    total: int
    up: int
    degraded: int
    down: int
    unknown: int


class LiveHealthResponse(BaseModel):
    services: list[ServiceLiveState]
    summary: HealthSummary
    generated_at: datetime


# ── Health history ────────────────────────────────────────────────────────────

class HealthPoint(BaseModel):
    time: datetime
    health_status: Optional[str] = None
    latency_ms: Optional[float] = None
    message: Optional[str] = None


class HealthHistoryResponse(BaseModel):
    service_id: str
    window: str
    points: list[HealthPoint]


# ── Risks ─────────────────────────────────────────────────────────────────────

class RiskItem(BaseModel):
    id: str
    severity: str                    # "critical" | "warning" | "watch"
    title: str
    summary: str
    affected_services: list[str]
    blast_radius: Optional[str] = None
    recommendation: Optional[str] = None
    metadata: dict[str, Any] = {}


class RisksResponse(BaseModel):
    risks: list[RiskItem]
    generated_at: datetime
