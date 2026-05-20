"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryPoint } from "@/hooks/useServiceDetail";

interface Props {
  points: HistoryPoint[];
  height?: number;
}

const STATUS_COLOR: Record<string, string> = {
  up:       "#22c55e",
  degraded: "#f59e0b",
  down:     "#ef4444",
};

export function LatencyHistoryChart({ points, height = 140 }: Props) {
  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center bg-gray-900 rounded text-gray-600 text-xs"
        style={{ height }}
      >
        {points.length === 0 ? "No history yet — checks run every 30 s" : "Collecting…"}
      </div>
    );
  }

  const formatted = points.map((p) => ({
    t:       new Date(p.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    latency: p.latency_ms != null ? parseFloat(p.latency_ms.toFixed(2)) : null,
    status:  p.health_status ?? "unknown",
  }));

  const maxLatency = Math.max(...points.map((p) => p.latency_ms ?? 0));
  const lineColor  = maxLatency > 200 ? "#ef4444" : maxLatency > 50 ? "#f59e0b" : "#22c55e";

  // Mark "down" intervals as reference lines
  const downPoints = formatted
    .filter((p) => p.status === "down")
    .map((p) => p.t);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={formatted} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          <linearGradient id="latency-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={lineColor} stopOpacity={0.25} />
            <stop offset="95%" stopColor={lineColor} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />

        <XAxis
          dataKey="t"
          tick={{ fill: "#475569", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "#475569", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          unit=" ms"
          width={48}
        />

        <Tooltip
          contentStyle={{ background: "#1e293b", border: "none", borderRadius: 6, fontSize: 11 }}
          labelStyle={{ color: "#94a3b8" }}
          itemStyle={{ color: lineColor }}
          formatter={(v) => typeof v === "number" ? [`${v.toFixed(2)} ms`, "latency"] : ["—", "latency"]}
        />

        {/* Highlight down moments */}
        {downPoints.map((t) => (
          <ReferenceLine key={t} x={t} stroke="#ef4444" strokeOpacity={0.4} strokeWidth={2} />
        ))}

        <Area
          type="monotone"
          dataKey="latency"
          stroke={lineColor}
          strokeWidth={1.5}
          fill="url(#latency-grad)"
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
