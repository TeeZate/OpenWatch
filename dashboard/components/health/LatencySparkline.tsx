"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LatencyPoint } from "@/hooks/useLiveHealth";

interface Props {
  data: LatencyPoint[];
  serviceId: string;
  height?: number;
}

export function LatencySparkline({ data, serviceId, height = 80 }: Props) {
  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center bg-gray-900 rounded text-gray-600 text-xs"
        style={{ height }}
      >
        Collecting data…
      </div>
    );
  }

  const formatted = data.map((p) => ({
    t:       new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    latency: parseFloat(p.latency.toFixed(2)),
  }));

  const max = Math.max(...data.map((p) => p.latency));
  const color = max > 200 ? "#ef4444" : max > 50 ? "#f59e0b" : "#22c55e";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={formatted} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`grad-${serviceId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" hide />
        <YAxis hide domain={[0, "auto"]} />
        <Tooltip
          contentStyle={{ background: "#1e293b", border: "none", borderRadius: 6, fontSize: 11 }}
          labelStyle={{ color: "#94a3b8" }}
          itemStyle={{ color }}
          formatter={(v: number) => [`${v} ms`, "latency"]}
        />
        <Area
          type="monotone"
          dataKey="latency"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#grad-${serviceId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
