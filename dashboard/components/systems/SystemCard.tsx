"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import type { MonitoredSystem } from "@/lib/api";

interface Props {
  system:   MonitoredSystem;
  onRemove: (id: string) => void;
  onClick:  (system: MonitoredSystem) => void;
}

const STATUS_STYLES: Record<string, { dot: string; label: string; bg: string; border: string }> = {
  up:       { dot: "bg-green-400",              label: "text-green-400",  bg: "bg-green-950/40",  border: "border-green-800/50"  },
  degraded: { dot: "bg-yellow-400",             label: "text-yellow-300", bg: "bg-yellow-950/40", border: "border-yellow-800/50" },
  down:     { dot: "bg-red-500 animate-pulse",  label: "text-red-400",    bg: "bg-red-950/40",    border: "border-red-800/50"    },
};

const DEFAULT_STYLE = { dot: "bg-gray-500", label: "text-gray-400", bg: "bg-gray-900", border: "border-gray-700" };

export function SystemCard({ system, onRemove, onClick }: Props) {
  const style      = system.health_status ? (STATUS_STYLES[system.health_status] ?? DEFAULT_STYLE) : DEFAULT_STYLE;
  const status     = system.health_status ?? "pending";
  const displayUrl = system.url.replace(/^https?:\/\//, "");
  const lastChecked = system.last_checked
    ? new Date(system.last_checked).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(system)}
      onKeyDown={(e) => e.key === "Enter" && onClick(system)}
      className={`relative rounded-xl border ${style.border} ${style.bg} p-5 flex flex-col gap-3
                  group cursor-pointer hover:brightness-110 transition-all hover:shadow-lg
                  hover:shadow-black/30 hover:-translate-y-0.5 focus:outline-none
                  focus:ring-2 focus:ring-blue-500`}
    >
      {/* Remove button */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(system.id); }}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity
                   w-6 h-6 rounded-full bg-gray-800 hover:bg-red-900 text-gray-400 hover:text-red-300
                   flex items-center justify-center text-xs leading-none z-10"
        title="Remove system"
      >
        ×
      </button>

      {/* Name + status dot */}
      <div className="flex items-center gap-2 pr-6">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${style.dot}`} />
        <span className="font-semibold text-white truncate text-base">{system.name}</span>
      </div>

      {/* URL */}
      <div className="text-xs text-gray-400 truncate font-mono">{displayUrl}</div>

      {/* Stats row */}
      <div className="flex items-center gap-4 mt-1">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest text-gray-500 mb-0.5">Status</span>
          <span className={`text-sm font-medium capitalize ${style.label}`}>{status}</span>
        </div>

        {system.latency_ms != null && (
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-gray-500 mb-0.5">Latency</span>
            <span className="text-sm font-medium text-gray-200">
              {system.latency_ms < 1000
                ? `${Math.round(system.latency_ms)} ms`
                : `${(system.latency_ms / 1000).toFixed(1)} s`}
            </span>
          </div>
        )}

        {/* View arrow hint */}
        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>

      {/* Last checked */}
      {lastChecked && (
        <div className="text-[10px] text-gray-600 mt-auto">
          Checked {lastChecked}
        </div>
      )}
      {!system.health_status && (
        <div className="text-[10px] text-gray-500 mt-auto animate-pulse">
          First probe in progress…
        </div>
      )}
    </div>
  );
}
