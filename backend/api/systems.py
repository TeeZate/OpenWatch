# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Systems management API — CRUD for explicitly monitored remote systems."""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from db.redis_client import SERVICE_KEY, SERVICES_SET
from db.systems import COUNT_SYSTEMS, DELETE_SYSTEM, INSERT_SYSTEM, SELECT_ALL_SYSTEMS

MAX_SYSTEMS = 10

router = APIRouter(prefix="/api/v1", tags=["systems"])


class AddSystemRequest(BaseModel):
    name: str
    url: str


class SystemResponse(BaseModel):
    id: str
    name: str
    url: str
    added_at: str
    health_status: Optional[str] = None
    latency_ms: Optional[float] = None
    last_checked: Optional[str] = None


class SystemsListResponse(BaseModel):
    systems: list[SystemResponse]
    total: int
    max: int


@router.get("/systems", response_model=SystemsListResponse)
async def list_systems(request: Request) -> SystemsListResponse:
    pool  = request.app.state.ts_pool
    redis = request.app.state.redis

    async with pool.acquire() as conn:
        rows = await conn.fetch(SELECT_ALL_SYSTEMS)

    systems: list[SystemResponse] = []
    for row in rows:
        raw = await redis.hgetall(SERVICE_KEY.format(service_id=row["id"]))
        latency = raw.get("latency_ms") if raw else None
        systems.append(SystemResponse(
            id=row["id"],
            name=row["name"],
            url=row["url"],
            added_at=row["added_at"].isoformat(),
            health_status=raw.get("health_status") if raw else None,
            latency_ms=float(latency) if latency else None,
            last_checked=raw.get("checked_at") if raw else None,
        ))

    return SystemsListResponse(systems=systems, total=len(systems), max=MAX_SYSTEMS)


@router.post("/systems", status_code=201)
async def add_system(body: AddSystemRequest, request: Request) -> dict:
    name = body.name.strip()
    url  = body.url.strip().rstrip("/")

    if not name:
        raise HTTPException(status_code=422, detail="Name is required")
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="URL must start with http:// or https://")

    pool = request.app.state.ts_pool
    async with pool.acquire() as conn:
        count = await conn.fetchval(COUNT_SYSTEMS)
        if count >= MAX_SYSTEMS:
            raise HTTPException(status_code=422, detail=f"Maximum {MAX_SYSTEMS} systems reached. Remove one to add another.")

        system_id = str(uuid.uuid4())
        result = await conn.fetchrow(INSERT_SYSTEM, system_id, name, url)
        if result is None:
            raise HTTPException(status_code=409, detail="A system with this URL is already being monitored.")

    return {"id": system_id, "name": name, "url": url, "message": "System added. First probe within 30 seconds."}


@router.delete("/systems/{system_id}", status_code=200)
async def remove_system(system_id: str, request: Request) -> dict:
    pool  = request.app.state.ts_pool
    redis = request.app.state.redis

    async with pool.acquire() as conn:
        row = await conn.fetchrow(DELETE_SYSTEM, system_id)
        if row is None:
            raise HTTPException(status_code=404, detail="System not found")

    await redis.delete(SERVICE_KEY.format(service_id=system_id))
    await redis.srem(SERVICES_SET, system_id)

    return {"deleted": system_id}
