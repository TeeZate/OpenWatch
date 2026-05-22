"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import dynamic from "next/dynamic";
import { useSystemDetail }   from "@/hooks/useSystemDetail";
import { useProbeStatus }    from "@/hooks/useProbeStatus";
import { useProbeExtended }  from "@/hooks/useProbeExtended";
import { ProbePanel }        from "./ProbePanel";
import { DatabasePanel }     from "./DatabasePanel";
import { APISchemaPanel }    from "./APISchemaPanel";
import { SyntheticsPanel }   from "./SyntheticsPanel";
import { ArchitectureMap }   from "./ArchitectureMap";
import type { MonitoredSystem, SubService, ProbeTopologyInfo } from "@/lib/api";

const SystemTopologyGraph = dynamic(
  () => import("./SystemTopologyGraph").then((m) => m.SystemTopologyGraph),
  { ssr: false, loading: () => <GraphSkeleton /> }
);

interface Props {
  system: MonitoredSystem;
  onBack: () => void;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  const s = status ?? "unknown";
  const cfg = {
    up:       "bg-green-900/50 text-green-400 border-green-700",
    degraded: "bg-yellow-900/50 text-yellow-400 border-yellow-700",
    down:     "bg-red-900/50 text-red-400 border-red-700",
    unknown:  "bg-gray-800 text-gray-400 border-gray-600",
  }[s] ?? "bg-gray-800 text-gray-400 border-gray-600";

  const dot = {
    up:       "bg-green-500",
    degraded: "bg-yellow-400 animate-pulse",
    down:     "bg-red-500 animate-pulse",
    unknown:  "bg-gray-500",
  }[s] ?? "bg-gray-500";

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-bold uppercase tracking-wider ${cfg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {s}
    </span>
  );
}

function KindIcon({ kind }: { kind: string }) {
  const icons: Record<string, string> = {
    database:      "🗄",
    postgres:      "🐘",
    postgresql:    "🐘",
    mongodb:       "🍃",
    redis:         "⚡",
    kafka:         "📨",
    payment:       "💳",
    storage:       "📦",
    elasticsearch: "🔍",
    email:         "✉",
    http:          "🌐",
    https:         "🌐",
  };
  return <span>{icons[kind] ?? "⚙"}</span>;
}

// ── Service check card ─────────────────────────────────────────────────────────

function ServiceCheckCard({ svc }: { svc: SubService }) {
  const statusColor = {
    up:       "border-green-700 bg-green-950/40",
    degraded: "border-yellow-600 bg-yellow-950/40",
    down:     "border-red-700 bg-red-950/40",
    unknown:  "border-gray-700 bg-gray-900/40",
  }[svc.status] ?? "border-gray-700 bg-gray-900/40";

  const dotColor = {
    up:       "bg-green-500",
    degraded: "bg-yellow-400 animate-pulse",
    down:     "bg-red-500 animate-pulse",
    unknown:  "bg-gray-500",
  }[svc.status] ?? "bg-gray-500";

  return (
    <div className={`rounded-lg border p-3 flex flex-col gap-1.5 ${statusColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KindIcon kind={svc.kind} />
          <span className="text-sm font-semibold text-gray-100 font-mono">{svc.name}</span>
        </div>
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      </div>
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span className="uppercase tracking-wider font-medium text-[10px]">{svc.kind}</span>
        {svc.latency_ms != null && (
          <span className="font-mono">{svc.latency_ms.toFixed(0)} ms</span>
        )}
      </div>
      {svc.message && (
        <p className="text-[11px] text-gray-500 truncate" title={svc.message}>
          {svc.message}
        </p>
      )}
    </div>
  );
}

// ── Alert banner ───────────────────────────────────────────────────────────────

function AlertsBanner({ services }: { services: SubService[] }) {
  const problems = services.filter((s) => s.status === "down" || s.status === "degraded");
  if (problems.length === 0) return null;

  return (
    <div className="border border-yellow-700/60 bg-yellow-950/30 rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
        <span className="text-xs font-bold text-yellow-400 uppercase tracking-widest">
          Alerts & Issues
        </span>
      </div>
      <ul className="space-y-1">
        {problems.map((p) => (
          <li key={p.name} className="text-sm font-mono text-yellow-200/80">
            <span className={`font-bold uppercase text-[10px] mr-2 ${
              p.status === "down" ? "text-red-400" : "text-yellow-400"
            }`}>
              {p.status}
            </span>
            <span className="text-yellow-100">{p.name}</span>
            {p.message && (
              <span className="text-yellow-500/70 ml-2">— {p.message}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Graph skeleton ─────────────────────────────────────────────────────────────

function GraphSkeleton() {
  return (
    <div className="w-full h-full bg-gray-950 rounded-lg flex items-center justify-center">
      <span className="text-gray-600 text-sm">Loading topology…</span>
    </div>
  );
}

// ── Infrastructure info panel ──────────────────────────────────────────────────

function formatUptime(s: number): string {
  if (s < 60)     return `${s}s`;
  if (s < 3600)   return `${Math.floor(s / 60)}m`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return `${d}d ${h}h`;
}

const OS_ICON: Record<string, string> = {
  linux:   "🐧",
  darwin:  "🍎",
  windows: "🪟",
};

function InfraPanel({
  topo,
  os,
}: {
  topo: Partial<ProbeTopologyInfo>;
  os:   Record<string, unknown>;
}) {
  const osIcon  = OS_ICON[topo.os ?? ""] ?? "🖥";
  const uptimeS = typeof os.uptime_s === "number" ? os.uptime_s : null;
  const load1m  = typeof os.load_1m  === "number" ? (os.load_1m  as number).toFixed(2) : null;
  const load5m  = typeof os.load_5m  === "number" ? (os.load_5m  as number).toFixed(2) : null;
  const load15m = typeof os.load_15m === "number" ? (os.load_15m as number).toFixed(2) : null;

  const cards: { label: string; value: string; mono?: boolean }[] = [];

  if (topo.hostname) cards.push({ label: "Hostname",     value: topo.hostname, mono: true });
  if (topo.os)       cards.push({ label: "Platform",     value: `${osIcon} ${topo.os}${topo.arch ? " · " + topo.arch : ""}` });
  if (topo.arch)     cards.push({ label: "Architecture", value: topo.arch, mono: true });
  if (uptimeS != null) cards.push({ label: "Uptime", value: formatUptime(uptimeS) });
  if (load1m)        cards.push({ label: "Load avg", value: `${load1m} · ${load5m ?? "—"} · ${load15m ?? "—"}`, mono: true });

  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {cards.map((c) => (
        <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2.5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">{c.label}</p>
          <p className={`text-sm font-semibold text-gray-100 truncate ${c.mono ? "font-mono" : ""}`}>
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Main detail view ───────────────────────────────────────────────────────────

export function SystemDetailView({ system, onBack }: Props) {
  const { detail, loading, error }  = useSystemDetail(system.id);
  const { status: probeStatus }     = useProbeStatus(system.id);
  const { data: extended }          = useProbeExtended(system.id);

  const active   = detail ?? system;
  const hostname = (() => {
    try { return new URL(system.url).hostname; } catch { return system.url; }
  })();

  const lastChecked = active.last_checked
    ? new Date(active.last_checked).toLocaleTimeString()
    : "pending first probe…";

  // Probe topology — passed to graph for 3-tier rendering
  const probeTopology = probeStatus?.connected
    ? (probeStatus.topology as Partial<ProbeTopologyInfo>)
    : undefined;

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-gray-800 flex-shrink-0 bg-gray-900">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Systems
        </button>

        <span className="text-gray-700">•</span>

        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="font-bold text-white text-base">{system.name}</span>
          <span className="text-gray-500 text-sm font-mono truncate">{hostname}</span>
          <StatusBadge status={active.health_status ?? undefined} />
          {active.latency_ms != null && (
            <span className="text-xs font-mono text-gray-400">
              {active.latency_ms.toFixed(0)} ms
            </span>
          )}
          {probeStatus?.connected && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-950/50 border border-green-800 text-green-400 text-[10px] font-bold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Probe
            </span>
          )}
        </div>

        <div className="text-xs text-gray-600 flex-shrink-0">
          Last probed: {lastChecked}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 min-h-0">

        {/* Loading / error */}
        {loading && !detail && (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Running first probe…
          </div>
        )}
        {error && (
          <div className="border border-red-800 bg-red-950/30 rounded-lg px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Alerts */}
        {detail && <AlertsBanner services={detail.sub_services} />}

        {/* ── Infrastructure info (probe-only) ──────────────────────────── */}
        {probeStatus?.connected && probeStatus.topology?.hostname && (
          <div>
            <SectionLabel label="Infrastructure" />
            <InfraPanel
              topo={probeStatus.topology as Partial<ProbeTopologyInfo>}
              os={probeStatus.os as Record<string, unknown>}
            />
          </div>
        )}

        {/* ── Architecture Map (probe-connected systems only) ────────────── */}
        {probeStatus?.connected && (
          <div>
            <SectionLabel label="Architecture Map" />
            <ArchitectureMap
              system={system}
              status={probeStatus}
              extended={extended ?? null}
            />
          </div>
        )}

        {/* Topology + Services — two-column when there are sub-services */}
        {detail && (
          <div className={`grid gap-5 ${
            detail.sub_services.length > 0
              ? "grid-cols-1 lg:grid-cols-5"
              : "grid-cols-1"
          }`}>

            {/* Topology graph */}
            <div className={`${detail.sub_services.length > 0 ? "lg:col-span-3" : ""}`}>
              <SectionLabel label="System Topology" />
              <div className={`rounded-lg overflow-hidden border border-gray-800 ${
                probeStatus?.connected
                  ? detail.sub_services.length > 0
                    ? "h-96 lg:h-[28rem]"
                    : "h-56"
                  : "h-72 lg:h-96"
              }`}>
                <SystemTopologyGraph
                  system={detail}
                  probeTopology={probeTopology}
                />
              </div>

              {/* Probe path info */}
              {detail.probe_path && (
                <p className="mt-2 text-[11px] text-gray-600 font-mono">
                  Health endpoint: {detail.probe_path}
                </p>
              )}
            </div>

            {/* Services grid */}
            {detail.sub_services.length > 0 && (
              <div className="lg:col-span-2">
                <SectionLabel label={`Services (${detail.sub_services.length})`} />
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {detail.sub_services.map((svc) => (
                    <ServiceCheckCard key={svc.name} svc={svc} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* No sub-services — show helpful hint */}
        {detail && detail.sub_services.length === 0 && !loading && (
          <div className="rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-4">
            <p className="text-gray-400 text-sm mb-1 font-semibold">No sub-services detected</p>
            {probeStatus?.connected ? (
              <div className="space-y-2">
                <p className="text-gray-500 text-xs">
                  The probe is connected but no services were discovered. To enable topology mapping,
                  add your database and cache connection strings as environment variables on the probe service:
                </p>
                <div className="bg-gray-950 border border-gray-700 rounded px-3 py-2 font-mono text-[11px] text-gray-400 space-y-0.5">
                  <div><span className="text-blue-400">DATABASE_URL</span>=postgresql://…</div>
                  <div><span className="text-red-400">REDIS_URL</span>=redis://…</div>
                  <div><span className="text-green-400">MONGODB_URL</span>=mongodb://…  <span className="text-gray-600"># optional</span></div>
                </div>
                <p className="text-gray-600 text-[11px]">
                  Add these in Railway → probe service → Variables, then redeploy.
                </p>
              </div>
            ) : (
              <p className="text-gray-600 text-xs">
                Install the OpenWatch probe inside your infrastructure to get full topology visibility.
              </p>
            )}
          </div>
        )}

        {/* Probe metrics + connection management */}
        <div>
          <SectionLabel label="Probe" />
          <ProbePanel system={system} />
        </div>

        {/* ── Synthetic frontend checks ──────────────────────────────────── */}
        {probeStatus?.connected && (
          <div>
            <SectionLabel label="Frontend Synthetic Checks" />
            <SyntheticsPanel synthetics={extended?.synthetics ?? []} />
          </div>
        )}

        {/* ── API Endpoints ──────────────────────────────────────────────── */}
        {probeStatus?.connected && (
          <div>
            <SectionLabel label="API Endpoints" />
            {extended?.api_schema ? (
              <APISchemaPanel schema={extended.api_schema} />
            ) : (
              <div className="rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-3 space-y-2">
                <p className="text-sm text-gray-400 font-semibold">API schema not yet collected</p>
                <p className="text-xs text-gray-600">
                  Set the <span className="font-mono text-yellow-400">API Service URL</span> in the
                  Discovery Config section below — the probe will pick it up automatically within 5 minutes.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Database schema ────────────────────────────────────────────── */}
        {probeStatus?.connected && (
          <div>
            <SectionLabel label="Database Schema" />
            {extended?.database ? (
              <DatabasePanel db={extended.database} />
            ) : (
              <div className="rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-3">
                <p className="text-sm text-gray-400 font-semibold mb-1">Schema not yet collected</p>
                <p className="text-xs text-gray-600">
                  Schema is collected every 5 minutes. Make sure <span className="font-mono text-blue-400">DATABASE_URL</span> is
                  set on the probe service. First collection happens on the next extended cycle.
                </p>
              </div>
            )}
          </div>
        )}

        {/* System info card */}
        <div>
          <SectionLabel label="System Info" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoCard label="URL" value={hostname} mono />
            <InfoCard
              label="Overall Status"
              value={active.health_status?.toUpperCase() ?? "—"}
              mono
              color={
                active.health_status === "up" ? "text-green-400" :
                active.health_status === "degraded" ? "text-yellow-400" :
                active.health_status === "down" ? "text-red-400" :
                "text-gray-400"
              }
            />
            <InfoCard
              label="Response Time"
              value={active.latency_ms != null ? `${active.latency_ms.toFixed(0)} ms` : "—"}
              mono
            />
            <InfoCard
              label="Sub-services"
              value={detail ? String(detail.sub_services.length) : "—"}
              mono
            />
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{label}</span>
    </div>
  );
}

function InfoCard({
  label, value, mono = false, color = "text-gray-100"
}: {
  label: string; value: string; mono?: boolean; color?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2.5">
      <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-sm font-semibold ${color} ${mono ? "font-mono" : ""} truncate`}>
        {value}
      </p>
    </div>
  );
}
