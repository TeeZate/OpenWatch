"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

import { useState } from "react";
import { RiskCard } from "./RiskCard";
import { useRisks } from "@/hooks/useRisks";

export function RiskPanel() {
  const { data, loading, error, criticalCount } = useRisks();
  const [open, setOpen] = useState(false);

  const risks      = data?.risks ?? [];
  const totalCount = risks.length;

  return (
    <div className={`border-t border-gray-800 bg-gray-950 transition-all duration-300 ${open ? "h-72" : "h-10"} flex flex-col flex-shrink-0`}>

      {/* ── Toggle bar ──────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 px-4 h-10 w-full text-left hover:bg-gray-900 transition-colors flex-shrink-0"
        aria-expanded={open}
      >
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
          Risks
        </span>

        {/* Count badges */}
        {totalCount > 0 ? (
          <div className="flex items-center gap-1.5">
            {criticalCount > 0 && (
              <span className="text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded">
                {criticalCount} critical
              </span>
            )}
            <span className="text-xs text-gray-600">{totalCount} total</span>
          </div>
        ) : loading ? (
          <span className="text-xs text-gray-600">checking…</span>
        ) : (
          <span className="text-xs text-green-600">no risks detected</span>
        )}

        <span className="ml-auto text-gray-600 text-xs">{open ? "▼" : "▲"}</span>
      </button>

      {/* ── Risk list ────────────────────────────────────────────────────── */}
      {open && (
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
          {error && (
            <p className="text-red-400 text-sm pt-2">{error}</p>
          )}
          {!loading && !error && risks.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-600 text-sm">
                No risks detected. Version checks run after each agent event.
              </p>
            </div>
          )}
          {risks.map((risk) => (
            <RiskCard key={risk.id} risk={risk} />
          ))}
          {data?.generated_at && (
            <p className="text-xs text-gray-700 text-right pt-1">
              Generated {new Date(data.generated_at).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
