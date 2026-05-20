"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

import cytoscape from "cytoscape";
import { useEffect, useRef } from "react";
import type { TopologyResponse, CytoscapeNodeData } from "@/lib/api";
import { cytoscapeStyles } from "./cytoscapeStyles";

interface Props {
  topology: TopologyResponse;
  healthMap?: Record<string, string>;   // serviceId → health_status
  onNodeSelect?: (node: CytoscapeNodeData | null) => void;
}

export function TopologyMap({ topology, healthMap = {}, onNodeSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef        = useRef<cytoscape.Core | null>(null);

  // ── Initialise Cytoscape once ──────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      style: cytoscapeStyles,
      layout: { name: "cose", animate: true, animationDuration: 400, padding: 40 },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.3,
      maxZoom: 4,
    });

    cy.on("tap", "node", (e) => {
      onNodeSelect?.(e.target.data() as CytoscapeNodeData);
    });
    cy.on("tap", (e) => {
      if (e.target === cy) onNodeSelect?.(null);
    });

    cyRef.current = cy;
    return () => cy.destroy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update elements when topology data changes ─────────────────────────────
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Merge health status into node data
    const nodes = topology.nodes.map((n) => ({
      data: {
        ...n.data,
        status: healthMap[n.data.id] ?? n.data.status ?? "unknown",
      },
    }));

    cy.batch(() => {
      cy.elements().remove();
      cy.add([...nodes, ...topology.edges]);
    });

    cy.layout({
      name: "cose",
      animate: true,
      animationDuration: 400,
      padding: 40,
      // @ts-ignore — cose accepts these undocumented options
      nodeRepulsion: 4500,
      idealEdgeLength: 100,
    }).run();
  }, [topology, healthMap]);

  // ── Patch health status on live updates without re-laying out ──────────────
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      Object.entries(healthMap).forEach(([id, status]) => {
        cy.$id(id).data("status", status);
      });
    });
  }, [healthMap]);

  // ── Resize observer ────────────────────────────────────────────────────────
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !containerRef.current) return;
    const ro = new ResizeObserver(() => cy.resize());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-gray-950 rounded-lg"
      aria-label="Service topology map"
    />
  );
}
