# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Request

from models.responses import (
    CytoscapeEdge,
    CytoscapeEdgeData,
    CytoscapeNode,
    CytoscapeNodeData,
    TopologyResponse,
)
from models.topology import FETCH_TOPOLOGY

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["topology"])


@router.get("/topology", response_model=TopologyResponse)
async def get_topology(request: Request) -> TopologyResponse:
    """
    Return the full service topology as a Cytoscape.js-compatible node/edge graph.
    Reads directly from Neo4j — reflects the last state written by the topology consumer.
    """
    driver = request.app.state.neo4j_driver
    nodes: list[CytoscapeNode] = []
    edges: list[CytoscapeEdge] = []

    async with driver.session() as session:
        result = await session.run(FETCH_TOPOLOGY)
        records = await result.data()

    for record in records:
        hostname  = record["hostname"]
        agent_id  = record["agent_id"]
        services  = record["services"]

        host_node_id = f"host:{hostname}"

        # Host node
        nodes.append(CytoscapeNode(data=CytoscapeNodeData(
            id=host_node_id,
            label=hostname,
            type="host",
            hostname=hostname,
        )))

        for svc in services:
            svc_id = svc["id"]

            # Service node
            nodes.append(CytoscapeNode(data=CytoscapeNodeData(
                id=svc_id,
                label=svc.get("name", svc_id),
                type="service",
                kind=svc.get("kind"),
                status=svc.get("health_status"),
                latency_ms=svc.get("latency_ms"),
                port=svc.get("port"),
                hostname=hostname,
            )))

            # RUNS edge: host → service
            edges.append(CytoscapeEdge(data=CytoscapeEdgeData(
                id=f"e-{host_node_id}-{svc_id}",
                source=host_node_id,
                target=svc_id,
            )))

    logger.debug("Topology: %d nodes %d edges", len(nodes), len(edges))
    return TopologyResponse(
        nodes=nodes,
        edges=edges,
        generated_at=datetime.now(timezone.utc),
    )
