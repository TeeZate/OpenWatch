"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import type { SyntheticResult } from "@/lib/api";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  up:       "border-green-700 bg-green-950/30",
  degraded: "border-yellow-600 bg-yellow-950/30",
  down:     "border-red-700 bg-red-950/30",
  unknown:  "border-gray-700 bg-gray-900/30",
};

const DOT_STYLE: Record<string, string> = {
  up:       "bg-green-500",
  degraded: "bg-yellow-400 animate-pulse",
  down:     "bg-red-500 animate-pulse",
  unknown:  "bg-gray-500",
};

// ── Synthetic card ─────────────────────────────────────────────────────────────

function SyntheticCard({ result }: { result: SyntheticResult }) {
  const status = result.status ?? "unknown";
  const border = STATUS_STYLE[status] ?? STATUS_STYLE.unknown;
  const dot    = DOT_STYLE[status]    ?? DOT_STYLE.unknown;

  return (
    <div className={`rounded-lg border p-3 flex flex-col gap-2 ${border}`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${dot}`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-100 font-mono truncate">{result.name}</p>
            <p className="text-[11px] text-gray-500 truncate" title={result.url}>{result.url}</p>
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          {result.status_code != null && (
            <span className={`text-xs font-mono font-bold ${
              result.status_code < 300 ? "text-green-400" :
              result.status_code < 400 ? "text-yellow-400" :
              "text-red-400"
            }`}>
              {result.status_code}
            </span>
          )}
        </div>
      </div>

      {/* Metrics row */}
      <div className="flex items-center gap-4 text-[11px] text-gray-500">
        <span className="font-mono">{result.latency_ms.toFixed(0)} ms</span>
        {result.redirects != null && result.redirects > 0 && (
          <span>{result.redirects} redirect{result.redirects > 1 ? "s" : ""}</span>
        )}
        {result.error && (
          <span className="text-red-400/80 truncate" title={result.error}>{result.error}</span>
        )}
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-4 space-y-1.5">
      <p className="text-sm text-gray-400 font-semibold">No synthetic checks configured</p>
      <p className="text-xs text-gray-600">
        Add your frontend URLs in the <span className="text-gray-400 font-medium">Discovery Config</span> section
        below — the probe picks them up automatically within 5 minutes.
      </p>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

interface Props {
  synthetics: SyntheticResult[];
}

export function SyntheticsPanel({ synthetics }: Props) {
  if (!synthetics || synthetics.length === 0) {
    return <EmptyState />;
  }

  const up       = synthetics.filter((s) => s.status === "up").length;
  const degraded = synthetics.filter((s) => s.status === "degraded").length;
  const down     = synthetics.filter((s) => s.status === "down").length;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-gray-500">{synthetics.length} URL{synthetics.length > 1 ? "s" : ""} monitored</span>
        {up > 0       && <span className="text-green-400">{up} up</span>}
        {degraded > 0 && <span className="text-yellow-400">{degraded} degraded</span>}
        {down > 0     && <span className="text-red-400">{down} down</span>}
      </div>

      {/* Cards — deduplicate by URL so duplicate entries never cause React key collisions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {synthetics
          .filter((s, i, arr) => arr.findIndex((x) => x.url === s.url) === i)
          .map((s, i) => (
            <SyntheticCard key={`${s.url}-${i}`} result={s} />
          ))}
      </div>
    </div>
  );
}
