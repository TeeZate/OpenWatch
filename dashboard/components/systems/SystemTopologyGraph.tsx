"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import cytoscape from "cytoscape";
import { useEffect, useRef } from "react";
import type { SystemDetail } from "@/lib/api";

interface Props {
  system: SystemDetail;
}

const STATUS_COLORS: Record<string, string> = {
  up:       "#22c55e",
  degraded: "#f59e0b",
  down:     "#ef4444",
  unknown:  "#4b5563",
};

const KIND_BG: Record<string, string> = {
  database:      "#1d4ed8",
  mongodb:       "#15803d",
  redis:         "#b91c1c",
  kafka:         "#6d28d9",
  payment:       "#0e7490",
  storage:       "#92400e",
  elasticsearch: "#0369a1",
  email:         "#be185d",
  http:          "#374151",
};

const KIND_LABEL: Record<string, string> = {
  database:      "DB",
  mongodb:       "Mongo",
  redis:         "Cache",
  kafka:         "Queue",
  payment:       "Pay",
  storage:       "Storage",
  elasticsearch: "Search",
  email:         "Mail",
  http:          "SVC",
};

export function SystemTopologyGraph({ system }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef        = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container:          containerRef.current,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.2,
      maxZoom: 4,
      style: [
        // ── Root node ──────────────────────────────────────────────────────
        {
          selector: 'node[type="root"]',
          style: {
            "shape":              "round-rectangle",
            "background-color":   "#1e3a5f",
            "border-color":       "data(borderColor)",
            "border-width":       3,
            "width":              160,
            "height":             52,
            "label":              "data(label)",
            "text-valign":        "center",
            "text-halign":        "center",
            "font-family":        "ui-monospace, monospace",
            "font-size":          12,
            "font-weight":        "bold",
            "color":              "#f1f5f9",
            "text-wrap":          "wrap",
            "text-max-width":     140,
          },
        },
        // ── Sub-service node ───────────────────────────────────────────────
        {
          selector: 'node[type="service"]',
          style: {
            "shape":              "round-rectangle",
            "background-color":   "data(bgColor)",
            "border-color":       "data(borderColor)",
            "border-width":       2,
            "width":              130,
            "height":             58,
            "label":              "data(label)",
            "text-valign":        "center",
            "text-halign":        "center",
            "font-family":        "ui-monospace, monospace",
            "font-size":          10,
            "color":              "#e2e8f0",
            "text-wrap":          "wrap",
            "text-max-width":     115,
          },
        },
        // ── Edges ──────────────────────────────────────────────────────────
        {
          selector: "edge",
          style: {
            "line-color":         "#334155",
            "target-arrow-color": "#334155",
            "target-arrow-shape": "triangle",
            "curve-style":        "bezier",
            "width":              1.5,
            "arrow-scale":        0.8,
          },
        },
        // ── Down edge highlight ────────────────────────────────────────────
        {
          selector: 'edge[status="down"]',
          style: {
            "line-color":         "#ef4444",
            "target-arrow-color": "#ef4444",
            "line-style":         "dashed",
          },
        },
        {
          selector: 'edge[status="degraded"]',
          style: {
            "line-color":         "#f59e0b",
            "target-arrow-color": "#f59e0b",
          },
        },
      ] as cytoscape.StylesheetStyle[],
    });
    cyRef.current = cy;

    const ro = new ResizeObserver(() => cy.resize());
    if (containerRef.current) ro.observe(containerRef.current);

    return () => { cy.destroy(); ro.disconnect(); };
  }, []);

  // Rebuild graph whenever system data changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const rootStatus = system.health_status ?? "unknown";
    const rootLabel  = system.name + "\n" + new URL(system.url).hostname;

    const nodes: cytoscape.ElementDefinition[] = [
      {
        data: {
          id:          "root",
          type:        "root",
          label:       rootLabel,
          borderColor: STATUS_COLORS[rootStatus] ?? STATUS_COLORS.unknown,
          status:      rootStatus,
        },
      },
    ];

    const edges: cytoscape.ElementDefinition[] = [];

    for (const svc of system.sub_services) {
      const nodeId = `svc_${svc.name}`;
      const latencyStr = svc.latency_ms != null
        ? `\n${svc.latency_ms.toFixed(0)} ms`
        : "";
      const kindTag    = KIND_LABEL[svc.kind] ?? "SVC";
      const label      = `[${kindTag}] ${svc.name}${latencyStr}`;

      nodes.push({
        data: {
          id:          nodeId,
          type:        "service",
          label,
          status:      svc.status,
          borderColor: STATUS_COLORS[svc.status] ?? STATUS_COLORS.unknown,
          bgColor:     KIND_BG[svc.kind] ?? KIND_BG.http,
        },
      });

      edges.push({
        data: {
          id:     `e_${nodeId}`,
          source: "root",
          target: nodeId,
          status: svc.status,
        },
      });
    }

    cy.batch(() => {
      cy.elements().remove();
      cy.add([...nodes, ...edges]);
    });

    const layout = system.sub_services.length === 0
      ? { name: "preset" as const }
      : {
          name:       "breadthfirst" as const,
          directed:   true,
          padding:    40,
          spacingFactor: 1.4,
          avoidOverlap: true,
        };

    cy.layout(layout).run();
    cy.fit(undefined, 40);
  }, [system]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-gray-950 rounded-lg"
      aria-label="System topology"
    />
  );
}
