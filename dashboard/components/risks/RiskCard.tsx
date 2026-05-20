"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

import { useState } from "react";
import type { RiskItem } from "@/lib/api";

const SEVERITY_STYLES: Record<string, { badge: string; border: string; label: string }> = {
  critical: {
    badge:  "bg-red-500/20 text-red-400 border border-red-500/30",
    border: "border-l-red-500",
    label:  "CRITICAL",
  },
  warning: {
    badge:  "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30",
    border: "border-l-yellow-400",
    label:  "WARNING",
  },
  watch: {
    badge:  "bg-blue-500/20 text-blue-400 border border-blue-500/30",
    border: "border-l-blue-500",
    label:  "WATCH",
  },
};

interface Props {
  risk: RiskItem;
}

export function RiskCard({ risk }: Props) {
  const [expanded, setExpanded] = useState(risk.severity === "critical");
  const styles = SEVERITY_STYLES[risk.severity] ?? SEVERITY_STYLES.watch;
  const meta   = risk.metadata as Record<string, unknown> | undefined;
  const aiGenerated = meta?.ai_generated === true;

  return (
    <article
      className={`bg-gray-900 border-l-4 ${styles.border} rounded-r-lg p-4 space-y-3`}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${styles.badge}`}>
            {styles.label}
          </span>
          <h3 className="text-sm font-medium text-gray-100">{risk.title}</h3>
          {aiGenerated && (
            <span className="text-xs text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded">
              AI
            </span>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0 mt-0.5"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {/* ── Summary (always visible) ─────────────────────────────────────── */}
      <p className="text-sm text-gray-300 leading-relaxed">{risk.summary}</p>

      {/* ── Expanded detail ─────────────────────────────────────────────── */}
      {expanded && (
        <div className="space-y-3 pt-1 border-t border-gray-800">

          {/* Affected services */}
          {risk.affected_services.length > 0 && (
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wide">Affected services</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {risk.affected_services.map((s) => (
                  <span
                    key={s}
                    className="text-xs font-mono bg-gray-800 text-gray-300 px-2 py-0.5 rounded"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Blast radius */}
          {risk.blast_radius && (
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wide">Blast radius</span>
              <p className="text-xs text-gray-400 mt-1">{risk.blast_radius}</p>
            </div>
          )}

          {/* Recommendation */}
          {risk.recommendation && (
            <div className="bg-gray-800/60 rounded p-3">
              <span className="text-xs text-gray-500 uppercase tracking-wide">Recommended action</span>
              <p className="text-xs text-gray-200 mt-1">{risk.recommendation}</p>
            </div>
          )}

          {/* CVEs */}
          {Array.isArray(meta?.cves) && (meta.cves as string[]).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(meta.cves as string[]).map((cve) => (
                <span
                  key={cve}
                  className="text-xs font-mono text-red-300 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded"
                >
                  {cve}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
