"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

import { LatencyHistoryChart } from "./LatencyHistoryChart";
import { RiskCard } from "@/components/risks/RiskCard";
import { useServiceDetail } from "@/hooks/useServiceDetail";
import type { CytoscapeNodeData, ServiceLiveState } from "@/lib/api";

interface Props {
  node:    CytoscapeNodeData;
  service: ServiceLiveState | null;
  onClose: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  up:      "text-green-400",
  degraded:"text-yellow-300",
  down:    "text-red-400",
  unknown: "text-gray-400",
};

const STATUS_DOT: Record<string, string> = {
  up:      "bg-green-500",
  degraded:"bg-yellow-400 animate-pulse",
  down:    "bg-red-500 animate-pulse",
  unknown: "bg-gray-500",
};

const KIND_COLOR: Record<string, string> = {
  redis:         "text-red-400",
  postgres:      "text-blue-400",
  mysql:         "text-orange-400",
  mongodb:       "text-green-400",
  http:          "text-cyan-400",
  kafka:         "text-purple-400",
  rabbitmq:      "text-yellow-400",
  elasticsearch: "text-sky-400",
};

export function ServiceDetailPanel({ node, service, onClose }: Props) {
  const isService = node.type === "service";
  const { detail, loading, error } = useServiceDetail(isService ? node.id : null);

  const status   = service?.health_status ?? node.status ?? "unknown";
  const latency  = service?.latency_ms   ?? node.latency_ms;
  const recentLog = (detail?.history ?? []).slice(-8).reverse();

  return (
    <aside className="w-80 border-l border-gray-800 bg-gray-900 flex flex-col overflow-hidden">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[status] ?? STATUS_DOT.unknown}`} />
          <h2 className="font-semibold text-white truncate">{node.label}</h2>
          {node.kind && (
            <span className={`text-xs flex-shrink-0 ${KIND_COLOR[node.kind] ?? "text-gray-400"}`}>
              {node.kind}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white text-xl leading-none ml-2 flex-shrink-0"
          aria-label="Close"
        >×</button>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── Stats row ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 divide-x divide-gray-800 border-b border-gray-800">
          <Stat
            label="Status"
            value={status}
            valueClass={STATUS_COLOR[status] ?? "text-gray-400"}
          />
          <Stat
            label="Uptime 1h"
            value={detail?.uptime != null ? `${detail.uptime}%` : "—"}
            valueClass={
              detail?.uptime == null ? "text-gray-400" :
              detail.uptime > 99    ? "text-green-400" :
              detail.uptime > 95    ? "text-yellow-300" : "text-red-400"
            }
          />
          <Stat
            label="Latency"
            value={latency != null ? `${latency.toFixed(1)} ms` : "—"}
          />
        </div>

        {/* ── Service metadata ────────────────────────────────────────────── */}
        <section className="px-4 py-3 border-b border-gray-800 space-y-1.5 text-xs">
          {node.port     && <MetaRow k="Port"     v={String(node.port)} />}
          {node.hostname && <MetaRow k="Host"     v={node.hostname} />}
          {service?.agent_id  && <MetaRow k="Agent"    v={service.agent_id} />}
          {service?.last_seen && (
            <MetaRow k="Last seen" v={new Date(service.last_seen).toLocaleTimeString()} />
          )}
          {service?.message && (
            <MetaRow k="Message" v={service.message} />
          )}
        </section>

        {/* ── Latency history ─────────────────────────────────────────────── */}
        {isService && (
          <section className="px-4 py-3 border-b border-gray-800">
            <SectionTitle>Latency — last hour</SectionTitle>
            {loading ? (
              <div className="text-xs text-gray-600 py-2">Loading history…</div>
            ) : error ? (
              <div className="text-xs text-red-400 py-2">{error}</div>
            ) : (
              <LatencyHistoryChart points={detail?.history ?? []} height={130} />
            )}
          </section>
        )}

        {/* ── Version risks ───────────────────────────────────────────────── */}
        {isService && detail && detail.risks.length > 0 && (
          <section className="px-4 py-3 border-b border-gray-800 space-y-2">
            <SectionTitle>Risks ({detail.risks.length})</SectionTitle>
            {detail.risks.map((r) => (
              <RiskCard key={r.id} risk={r} />
            ))}
          </section>
        )}
        {isService && detail && detail.risks.length === 0 && (
          <section className="px-4 py-3 border-b border-gray-800">
            <SectionTitle>Risks</SectionTitle>
            <p className="text-xs text-green-700 mt-1">No risks detected for this service.</p>
          </section>
        )}

        {/* ── Recent health log ────────────────────────────────────────────── */}
        {isService && recentLog.length > 0 && (
          <section className="px-4 py-3">
            <SectionTitle>Recent checks</SectionTitle>
            <ul className="space-y-1 mt-2">
              {recentLog.map((p, i) => {
                const st = p.health_status ?? "unknown";
                return (
                  <li key={i} className="flex items-center gap-2 text-xs font-mono">
                    <span className={`flex-shrink-0 ${STATUS_COLOR[st] ?? "text-gray-500"}`}>
                      {st.padEnd(8)}
                    </span>
                    <span className="text-gray-500">
                      {p.latency_ms != null ? `${p.latency_ms.toFixed(1)}ms` : "—"}
                    </span>
                    <span className="text-gray-600 truncate">{p.message ?? ""}</span>
                    <span className="ml-auto text-gray-700 flex-shrink-0">
                      {new Date(p.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Host node — no time-series data */}
        {!isService && (
          <div className="px-4 py-8 text-center text-gray-600 text-sm">
            Select a service node to see health details.
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Small helper components ───────────────────────────────────────────────────

function Stat({ label, value, valueClass = "text-gray-100" }: {
  label: string; value: string; valueClass?: string;
}) {
  return (
    <div className="px-3 py-2.5 text-center">
      <div className={`text-sm font-semibold font-mono ${valueClass}`}>{value}</div>
      <div className="text-xs text-gray-600 mt-0.5">{label}</div>
    </div>
  );
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-600">{k}</span>
      <span className="text-gray-300 font-mono truncate text-right">{v}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
      {children}
    </h3>
  );
}
