"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useProbeMetrics } from "@/hooks/useProbeMetrics";
import type { ProbeMetricsWindow } from "@/lib/api";

interface Props {
  systemId: string;
}

type ChartTab = "cpu_mem" | "disk" | "network";

const WINDOWS: { label: string; value: ProbeMetricsWindow }[] = [
  { label: "30m", value: "30m" },
  { label: "1h",  value: "1h"  },
  { label: "3h",  value: "3h"  },
  { label: "6h",  value: "6h"  },
  { label: "24h", value: "24h" },
];

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 6,
    fontSize: 11,
  },
  labelStyle:   { color: "#64748b" },
};

function formatBytes(bps: number): string {
  if (bps > 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`;
  if (bps > 1_000)     return `${(bps / 1_000).toFixed(0)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}

export function ProbeMetricsChart({ systemId }: Props) {
  const [tab, setTab]       = useState<ChartTab>("cpu_mem");
  const [window, setWindow] = useState<ProbeMetricsWindow>("1h");

  const { points, loading } = useProbeMetrics(systemId, window);

  const formatted = points.map((p) => ({
    t:            new Date(p.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    cpu:          p.cpu_pct       ?? 0,
    mem:          p.mem_used_pct  ?? 0,
    disk:         p.disk_used_pct ?? 0,
    bytes_in:     p.bytes_in_ps   ?? 0,
    bytes_out:    p.bytes_out_ps  ?? 0,
    connections:  p.connections   ?? 0,
  }));

  if (loading && points.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-gray-600 text-xs">
        Loading history…
      </div>
    );
  }

  if (points.length < 2) {
    return (
      <div className="h-32 flex items-center justify-center text-gray-600 text-xs">
        Collecting history — appears after 2+ pushes (~1 min)
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Controls row */}
      <div className="flex items-center justify-between">
        {/* Tab selector */}
        <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-0.5">
          {(
            [
              { id: "cpu_mem", label: "CPU / Mem" },
              { id: "disk",    label: "Disk" },
              { id: "network", label: "Network" },
            ] as { id: ChartTab; label: string }[]
          ).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors ${
                tab === id
                  ? "bg-gray-700 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Window selector */}
        <div className="flex items-center gap-1">
          {WINDOWS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setWindow(value)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                window === value
                  ? "text-blue-400 font-bold"
                  : "text-gray-600 hover:text-gray-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-gray-950/40 rounded-lg border border-gray-800 p-2">
        {tab === "cpu_mem" && (
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={formatted} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="cpu-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="mem-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#a855f7" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a855f7" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="t" tick={{ fill: "#475569", fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#475569", fontSize: 9 }} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} width={32} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name === "cpu" ? "CPU" : "Memory"]} />
              <Area type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={1.5} fill="url(#cpu-grad)" dot={false} connectNulls isAnimationActive={false} />
              <Area type="monotone" dataKey="mem" stroke="#a855f7" strokeWidth={1.5} fill="url(#mem-grad)" dot={false} connectNulls isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {tab === "disk" && (
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={formatted} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="disk-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#14b8a6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="t" tick={{ fill: "#475569", fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#475569", fontSize: 9 }} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} width={32} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(1)}%`, "Disk Used"]} />
              <Area type="monotone" dataKey="disk" stroke="#14b8a6" strokeWidth={1.5} fill="url(#disk-grad)" dot={false} connectNulls isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {tab === "network" && (
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={formatted} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="in-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="out-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="t" tick={{ fill: "#475569", fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#475569", fontSize: 9 }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => v > 999 ? `${(v/1000).toFixed(0)}K` : String(v)} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, name: string) => [formatBytes(v), name === "bytes_in" ? "Inbound" : "Outbound"]} />
              <Area type="monotone" dataKey="bytes_in"  stroke="#22c55e" strokeWidth={1.5} fill="url(#in-grad)"  dot={false} connectNulls isAnimationActive={false} />
              <Area type="monotone" dataKey="bytes_out" stroke="#f97316" strokeWidth={1.5} fill="url(#out-grad)" dot={false} connectNulls isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 px-1">
        {tab === "cpu_mem" && (
          <>
            <LegendDot color="bg-blue-500"   label="CPU" />
            <LegendDot color="bg-purple-500" label="Memory" />
          </>
        )}
        {tab === "disk" && <LegendDot color="bg-teal-500" label="Disk used %" />}
        {tab === "network" && (
          <>
            <LegendDot color="bg-green-500" label="Inbound" />
            <LegendDot color="bg-orange-500" label="Outbound" />
          </>
        )}
        <span className="ml-auto text-[9px] text-gray-600">{points.length} samples</span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-[10px] text-gray-500">{label}</span>
    </div>
  );
}
