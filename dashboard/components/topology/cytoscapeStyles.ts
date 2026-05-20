// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

/** Colour by service kind. */
const KIND_COLORS: Record<string, string> = {
  redis:         "#ef4444",
  postgres:      "#3b82f6",
  mysql:         "#f97316",
  mongodb:       "#22c55e",
  http:          "#06b6d4",
  kafka:         "#8b5cf6",
  rabbitmq:      "#f59e0b",
  elasticsearch: "#0ea5e9",
  tcp:           "#6b7280",
};

/** Border colour by health status. */
const STATUS_COLORS: Record<string, string> = {
  up:       "#22c55e",
  degraded: "#f59e0b",
  down:     "#ef4444",
  unknown:  "#4b5563",
};

export const cytoscapeStyles: cytoscape.StylesheetStyle[] = [
  // ── Base node ──────────────────────────────────────────────────────────────
  {
    selector: "node",
    style: {
      "label":                    "data(label)",
      "font-family":              "ui-monospace, monospace",
      "font-size":                11,
      "color":                    "#f1f5f9",
      "text-valign":              "bottom",
      "text-margin-y":            6,
      "text-outline-width":       2,
      "text-outline-color":       "#0f172a",
      "border-width":             3,
      "border-color":             "#4b5563",
      "width":                    48,
      "height":                   48,
    },
  },

  // ── Host node ──────────────────────────────────────────────────────────────
  {
    selector: 'node[type="host"]',
    style: {
      "background-color":  "#1e40af",
      "shape":             "round-rectangle",
      "width":             64,
      "height":            36,
      "font-size":         12,
      "font-weight":       "bold",
      "text-valign":       "center",
      "border-color":      "#3b82f6",
      "border-width":      2,
    },
  },

  // ── Service nodes by kind ──────────────────────────────────────────────────
  ...Object.entries(KIND_COLORS).map(([kind, color]) => ({
    selector: `node[kind="${kind}"]`,
    style: { "background-color": color } as cytoscape.Css.Node,
  })),

  // ── Health status borders ──────────────────────────────────────────────────
  ...Object.entries(STATUS_COLORS).map(([status, color]) => ({
    selector: `node[status="${status}"]`,
    style: { "border-color": color, "border-width": 3 } as cytoscape.Css.Node,
  })),

  // ── Selected node ──────────────────────────────────────────────────────────
  {
    selector: "node:selected",
    style: {
      "border-color":  "#f8fafc",
      "border-width":  4,
      "overlay-color": "#f8fafc",
      "overlay-opacity": 0.1,
    },
  },

  // ── Edges ──────────────────────────────────────────────────────────────────
  {
    selector: "edge",
    style: {
      "line-color":          "#334155",
      "target-arrow-color":  "#334155",
      "target-arrow-shape":  "triangle",
      "curve-style":         "bezier",
      "width":               1.5,
      "arrow-scale":         0.8,
    },
  },
  {
    selector: "edge:selected",
    style: { "line-color": "#94a3b8", "target-arrow-color": "#94a3b8" },
  },
];
