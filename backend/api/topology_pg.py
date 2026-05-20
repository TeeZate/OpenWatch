# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Topology API backed by plain PostgreSQL (Railway lite backend)."""

from __future__ import annotations

from fastapi import APIRouter, Request

from db.postgres_topology import FETCH_TOPOLOGY_PG
from models.responses import CytoscapeEdge, CytoscapeNode, TopologyResponse

router = APIRouter(prefix="/api/v1", tags=["topology"])


@router.get("/topology", response_model=TopologyResponse)
async def get_topology(request: Request) -> TopologyResponse:
    pool = request.app.state.ts_pool
    nodes: list[CytoscapeNode] = []
    edges: list[CytoscapeEdge] = []
    seen_hosts: set[str] = set()

    async with pool.acquire() as conn:
        rows = await conn.fetch(FETCH_TOPOLOGY_PG)

    for row in rows:
        host_id  = row["host_id"]
        svc_id   = row["service_id"]
        hostname = row["hostname"]

        if host_id not in seen_hosts:
            nodes.append(CytoscapeNode(data={
                "id":     host_id,
                "label":  hostname,
                "kind":   "host",
                "health": "unknown",
            }))
            seen_hosts.add(host_id)

        nodes.append(CytoscapeNode(data={
            "id":     svc_id,
            "label":  row["name"] or row["kind"],
            "kind":   row["kind"],
            "health": "unknown",
            "port":   row["port"],
        }))
        edges.append(CytoscapeEdge(data={
            "id":     f"{host_id}-{svc_id}",
            "source": host_id,
            "target": svc_id,
        }))

    return TopologyResponse(nodes=nodes, edges=edges)
