"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useMemo, useState } from "react";
import type {
  MonitoredSystem,
  SystemDetail,
  ProbeStatusResponse,
  ProbeExtendedData,
  APIEndpoint,
  FrontendPageInfo,
  DatabaseInfo,
} from "@/lib/api";

// ── Layout constants ──────────────────────────────────────────────────────────

const W   = 1400;
const H   = 860;
const PAD = 44;

const LAYER = {
  clients:   { y: 22,  h: 88  },
  frontends: { y: 158, h: 140 },
  api:       { y: 350, h: 210 },
  infra:     { y: 616, h: 120 },
};

const NODE_W = { client: 176, frontend: 210, infra: 184 };

// ── Colours ───────────────────────────────────────────────────────────────────

const C = {
  client:   { border: "#3b82f6", bg: "#0f172a", title: "#93c5fd", dim: "#475569" },
  frontend: {
    up:      { border: "#22c55e", bg: "#0a1a0a", title: "#86efac" },
    degraded:{ border: "#f59e0b", bg: "#1a1008", title: "#fde047" },
    down:    { border: "#ef4444", bg: "#1a0808", title: "#fca5a5" },
    unknown: { border: "#334155", bg: "#111117", title: "#94a3b8" },
  },
  api:   { border: "#6366f1", bg: "#0e0e1a", title: "#a5b4fc", dim: "#334155" },
  infra: {
    database:   { border: "#3b82f6", bg: "#0d1520", title: "#93c5fd" },
    cache:      { border: "#ef4444", bg: "#1a0a0a", title: "#fca5a5" },
    payment:    { border: "#22c55e", bg: "#0a1a0a", title: "#86efac" },
    email:      { border: "#a855f7", bg: "#14091a", title: "#d8b4fe" },
    ai:         { border: "#06b6d4", bg: "#071820", title: "#67e8f9" },
    queue:      { border: "#f97316", bg: "#1a0d00", title: "#fdba74" },
    auth:       { border: "#eab308", bg: "#1a1200", title: "#fde047" },
    sms:        { border: "#22c55e", bg: "#0a1a0a", title: "#86efac" },
    storage:    { border: "#d97706", bg: "#1a1000", title: "#fbbf24" },
    monitoring: { border: "#ec4899", bg: "#1a0a14", title: "#f9a8d4" },
    cloud:      { border: "#f97316", bg: "#1a0d00", title: "#fdba74" },
    realtime:   { border: "#38bdf8", bg: "#071820", title: "#7dd3fc" },
    vcs:        { border: "#94a3b8", bg: "#0a0a0f", title: "#cbd5e1" },
    crm:        { border: "#64748b", bg: "#0a0a0f", title: "#94a3b8" },
    search:     { border: "#0ea5e9", bg: "#071018", title: "#38bdf8" },
    default:    { border: "#334155", bg: "#111117", title: "#94a3b8" },
  } as Record<string, { border: string; bg: string; title: string }>,
};

const TAG_COLOR: Record<string, string> = {
  auth: "#3b82f6", users: "#22c55e", user: "#22c55e", merchants: "#a855f7",
  merchant: "#a855f7", marketplace: "#f59e0b", wallet: "#22c55e", payment: "#22c55e",
  admin: "#475569", health: "#06b6d4", products: "#f97316", orders: "#ec4899",
  webhooks: "#94a3b8", default: "#475569",
};

function tagColor(tag: string): string {
  const key = tag.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, v] of Object.entries(TAG_COLOR)) {
    if (key.includes(k)) return v;
  }
  return TAG_COLOR.default;
}

const HOSTING_ICON: Record<string, string> = {
  "Railway": "🚂", "Fly.io": "🪁", "Render": "🖥", "Heroku": "💜",
  "AWS": "☁", "Vercel": "▲", "Cloud Run": "☁", "Netlify": "🌐",
};

const FW_COLOR: Record<string, string> = {
  "Next.js": "#ffffff", "React": "#61dafb", "Vue.js": "#42b883",
  "Nuxt.js": "#00dc82", "Gatsby": "#a855f7", "Astro": "#ff5d01",
  "SvelteKit": "#ff3e00", "Angular": "#dd0031",
};

// ── Internal node types ───────────────────────────────────────────────────────

interface FrontendNode {
  id: string; label: string; url: string; status: string; latency?: number;
  framework: string; totalPages: number|null; publicPages: number|null; protectedPages: number|null;
}
interface InfraNode {
  id: string; name: string; kind: string; icon: string; sub: string; status?: string; latency?: number;
}
interface ClientNode { id: string; label: string; sub: string; detail: string; }
interface RouteGroup { tag: string; endpoints: APIEndpoint[]; total: number; color: string; }

type SelNode = { id: string; type: "frontend" | "api" | "infra" | "client" } | null;

// ── Layout helpers ────────────────────────────────────────────────────────────

function row(items: string[], nodeW: number, y: number) {
  if (items.length === 0) return [];
  const usable = W - 2 * PAD;
  const gap = items.length === 1 ? 0 : Math.max(10, (usable - items.length * nodeW) / (items.length - 1));
  const totalUsed = items.length * nodeW + (items.length - 1) * gap;
  const startX = PAD + (usable - totalUsed) / 2;
  return items.map((id, i) => ({ id, x: startX + i * (nodeW + gap), y }));
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function PanelHeader({ title, sub, icon, onClose }: {
  title: string; sub?: string; icon: string; onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between px-4 py-3.5 border-b border-gray-800 sticky top-0 bg-[#0d0d12] z-10">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-lg flex-shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate">{title}</p>
          {sub && <p className="text-[10px] text-gray-500 truncate mt-0.5">{sub}</p>}
        </div>
      </div>
      <button
        onClick={onClose}
        className="w-6 h-6 rounded flex items-center justify-center text-gray-600
                   hover:text-gray-300 hover:bg-gray-800 transition-colors flex-shrink-0 ml-2 text-base leading-none"
      >
        ×
      </button>
    </div>
  );
}

function StatusDot({ status }: { status?: string }) {
  const color = status === "up" ? "bg-green-500" : status === "down" ? "bg-red-500" : status === "degraded" ? "bg-yellow-500" : "bg-gray-600";
  const text  = status === "up" ? "text-green-400" : status === "down" ? "text-red-400" : status === "degraded" ? "text-yellow-400" : "text-gray-500";
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
      <span className={`text-xs capitalize ${text}`}>{status ?? "unknown"}</span>
    </span>
  );
}

function MethodBadge({ method }: { method: string }) {
  const cls =
    method === "GET"    ? "text-green-400 bg-green-950" :
    method === "POST"   ? "text-blue-400 bg-blue-950" :
    method === "DELETE" ? "text-red-400 bg-red-950" :
    method === "PATCH"  ? "text-orange-400 bg-orange-950" :
    method === "PUT"    ? "text-yellow-400 bg-yellow-950" :
    "text-gray-400 bg-gray-800";
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${cls}`}>
      {method}
    </span>
  );
}

// ── Frontend panel ────────────────────────────────────────────────────────────

function FrontendPanel({ node, extended, onClose }: {
  node: FrontendNode; extended: ProbeExtendedData | null; onClose: () => void;
}) {
  const feInfo: FrontendPageInfo | undefined = extended?.frontends?.find(f => {
    try { return new URL(f.url).hostname === node.label; } catch { return false; }
  });

  const fwColor = FW_COLOR[node.framework] ?? "#6366f1";
  const hasPages = feInfo && feInfo.total_pages > 0;

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title={node.label} sub={node.url} icon="🌐" onClose={onClose} />

      {/* Meta */}
      <div className="px-4 py-3 border-b border-gray-800 space-y-2.5">
        {node.framework ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-gray-600 w-20 flex-shrink-0">Framework</span>
            <span className="text-xs font-bold" style={{ color: fwColor }}>
              {node.framework}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-gray-600 w-20 flex-shrink-0">Framework</span>
            <span className="text-xs text-gray-600 italic">detecting…</span>
          </div>
        )}
        <div className="flex items-center gap-4">
          <StatusDot status={node.status} />
          {node.latency != null && (
            <span className="text-xs text-gray-500 font-mono">{node.latency.toFixed(0)} ms</span>
          )}
        </div>
      </div>

      {/* Page summary */}
      {hasPages && (
        <div className="px-4 py-3 border-b border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-widest text-gray-600">Pages</span>
            <span className="text-xs text-gray-400">{feInfo.total_pages} discovered</span>
          </div>
          <div className="flex items-center gap-4 text-xs mb-2">
            <span className="flex items-center gap-1.5 text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {feInfo.public_pages} public
            </span>
            <span className="flex items-center gap-1.5 text-yellow-400">
              <span>🔒</span>
              {feInfo.protected_pages} auth-protected
            </span>
          </div>
          {/* Progress bar */}
          <div className="h-1 bg-gray-800 rounded-full overflow-hidden flex">
            <div
              className="h-full bg-green-600 transition-all"
              style={{ width: `${(feInfo.public_pages / feInfo.total_pages) * 100}%` }}
            />
            <div
              className="h-full bg-yellow-600 transition-all"
              style={{ width: `${(feInfo.protected_pages / feInfo.total_pages) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Page list */}
      <div className="flex-1 overflow-y-auto">
        {feInfo?.pages && feInfo.pages.length > 0 ? (
          <>
            <div className="px-4 pt-3 pb-1">
              <p className="text-[10px] uppercase tracking-widest text-gray-600">Page Map</p>
            </div>
            <div className="divide-y divide-gray-800/40">
              {feInfo.pages.map((page, i) => (
                <div key={i} className="px-4 py-2.5 flex items-start gap-2.5 hover:bg-white/[0.02] transition-colors">
                  <span className={`text-xs mt-0.5 flex-shrink-0 ${page.auth_required ? "text-yellow-500" : "text-green-600"}`}>
                    {page.auth_required ? "🔒" : "●"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-gray-200 truncate">{page.path}</span>
                      {page.status_code > 0 && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 font-mono ${
                          page.status_code < 300 ? "bg-green-950 text-green-400" :
                          page.status_code < 400 ? "bg-blue-950 text-blue-400" :
                          "bg-red-950 text-red-400"
                        }`}>{page.status_code}</span>
                      )}
                    </div>
                    {page.title && (
                      <p className="text-[10px] text-gray-500 truncate mt-0.5 italic">{page.title}</p>
                    )}
                    {page.redirects_to && (
                      <p className="text-[10px] text-blue-400/70 truncate mt-0.5 font-mono">
                        → {page.redirects_to}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 h-40 px-6 text-center">
            <span className="text-2xl opacity-30">📄</span>
            <p className="text-xs text-gray-500">Page discovery runs every 5 min.</p>
            <p className="text-[11px] text-gray-600">Deploy the updated probe to start seeing pages here.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── API panel ─────────────────────────────────────────────────────────────────

function APIPanel({ routeGroups, schema, arch, hosting, runtime, extended, onClose }: {
  routeGroups: RouteGroup[]; schema: ProbeExtendedData["api_schema"];
  arch: ProbeExtendedData["architecture"]; hosting: string; runtime: string;
  extended: ProbeExtendedData | null; onClose: () => void;
}) {
  const allEndpoints = schema?.endpoints ?? [];
  const [openTag, setOpenTag] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title={schema?.title ?? "API Service"}
        sub={`${allEndpoints.length} endpoints discovered`}
        icon="⚡"
        onClose={onClose}
      />

      {/* Meta */}
      <div className="px-4 py-3 border-b border-gray-800 space-y-1.5 text-xs">
        {schema?.version && (
          <div className="flex gap-3">
            <span className="text-gray-600 w-16 flex-shrink-0">Version</span>
            <span className="text-purple-300 font-mono">v{schema.version}</span>
          </div>
        )}
        {hosting && (
          <div className="flex gap-3">
            <span className="text-gray-600 w-16 flex-shrink-0">Hosting</span>
            <span className="text-blue-300">{HOSTING_ICON[hosting] ?? ""} {hosting}</span>
          </div>
        )}
        {runtime && (
          <div className="flex gap-3">
            <span className="text-gray-600 w-16 flex-shrink-0">Runtime</span>
            <span className="text-gray-300 font-mono">{runtime}</span>
          </div>
        )}
        {arch?.integrations && arch.integrations.length > 0 && (
          <div className="flex gap-3">
            <span className="text-gray-600 w-16 flex-shrink-0">Integrations</span>
            <span className="text-gray-400">{arch.integrations.map(i => i.name).join(", ")}</span>
          </div>
        )}
      </div>

      {/* Route groups — accordion */}
      <div className="flex-1 overflow-y-auto">
        {routeGroups.length > 0 ? (
          <div>
            <div className="px-4 pt-3 pb-1.5">
              <p className="text-[10px] uppercase tracking-widest text-gray-600">Endpoints</p>
            </div>
            {routeGroups.map(rg => {
              const isOpen = openTag === rg.tag;
              const groupEps = allEndpoints.filter(ep => (ep.tags?.[0] ?? "general") === rg.tag);
              return (
                <div key={rg.tag} className="border-b border-gray-800/50">
                  <button
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors text-left"
                    onClick={() => setOpenTag(isOpen ? null : rg.tag)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px]">{isOpen ? "▼" : "▶"}</span>
                      <span className="text-xs font-bold" style={{ color: rg.color }}>/{rg.tag}</span>
                    </div>
                    <span className="text-[10px] text-gray-600">{rg.total}</span>
                  </button>
                  {isOpen && (
                    <div className="pb-2 bg-black/20">
                      {groupEps.map((ep, i) => (
                        <div key={i} className="flex items-center gap-2 px-6 py-1.5">
                          <MethodBadge method={ep.method} />
                          <span className="font-mono text-[11px] text-gray-400 truncate">{ep.path}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 h-40 px-6 text-center">
            <span className="text-2xl opacity-30">📡</span>
            <p className="text-xs text-gray-500">OpenAPI schema not yet discovered.</p>
            <p className="text-[11px] text-gray-600">Set the Service URL in Discovery Config.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Infra panel ───────────────────────────────────────────────────────────────

function InfraPanel({ node, extended, arch, onClose }: {
  node: InfraNode; extended: ProbeExtendedData | null;
  arch: ProbeExtendedData["architecture"]; onClose: () => void;
}) {
  const db = extended?.database ?? null;
  const sc = C.infra[node.kind] ?? C.infra.default;
  const icon = node.icon;

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title={node.name} sub={node.kind} icon={icon} onClose={onClose} />

      {/* Status + latency */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-5">
        <StatusDot status={node.status} />
        {node.latency != null && (
          <span className="text-xs text-gray-500 font-mono">{node.latency.toFixed(0)} ms</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── DATABASE ── */}
        {node.kind === "database" && (
          <div className="p-4 space-y-5">
            {/* DB meta */}
            <div className="space-y-2 text-xs">
              {db?.version && (
                <div className="flex gap-3">
                  <span className="text-gray-600 w-20 flex-shrink-0">Engine</span>
                  <span className="text-gray-300 font-mono">{db.version}</span>
                </div>
              )}
              {db?.db_name && (
                <div className="flex gap-3">
                  <span className="text-gray-600 w-20 flex-shrink-0">Database</span>
                  <span className="text-blue-300 font-mono">{db.db_name}</span>
                </div>
              )}
              {db && db.size_bytes > 0 && (
                <div className="flex gap-3">
                  <span className="text-gray-600 w-20 flex-shrink-0">Total size</span>
                  <span className="text-gray-300">{(db.size_bytes / 1_048_576).toFixed(2)} MB</span>
                </div>
              )}
              <div className="flex gap-3">
                <span className="text-gray-600 w-20 flex-shrink-0">Tables</span>
                <span className="text-gray-300">{db?.tables?.length ?? "–"}</span>
              </div>
              <div className="flex gap-3">
                <span className="text-gray-600 w-20 flex-shrink-0">Connected</span>
                <StatusDot status={db?.connected ? "up" : "down"} />
              </div>
            </div>

            {/* Table list */}
            {db?.tables && db.tables.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-widest text-gray-600">Schema</p>
                {db.tables.map(tbl => (
                  <details key={tbl.name} className="group">
                    <summary
                      className="flex items-center justify-between px-3 py-2 bg-gray-900 rounded-lg
                                 cursor-pointer list-none hover:bg-gray-800 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[9px] text-gray-600 group-open:rotate-90 transition-transform">▶</span>
                        <span className="font-mono text-xs text-gray-200 truncate">{tbl.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-gray-600 flex-shrink-0 ml-2">
                        {tbl.row_est > 0 && <span>{tbl.row_est.toLocaleString()} rows</span>}
                        {tbl.size_bytes > 0 && <span>{(tbl.size_bytes / 1_048_576).toFixed(1)} MB</span>}
                      </div>
                    </summary>
                    <div className="mt-1 px-3 pb-1 space-y-0.5">
                      {tbl.columns?.map(col => (
                        <div key={col.name} className="flex items-center gap-2 py-0.5">
                          <span className="w-3 flex-shrink-0 text-[10px]">
                            {col.is_pk ? "🔑" : " "}
                          </span>
                          <span className="font-mono text-[11px] text-gray-300 w-32 truncate">{col.name}</span>
                          <span className="font-mono text-[10px] text-gray-600 truncate">{col.data_type}</span>
                          {col.nullable && <span className="text-[9px] text-gray-700 flex-shrink-0">null</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}

            {!db && (
              <div className="flex flex-col items-center justify-center gap-2 h-32 text-center">
                <span className="text-2xl opacity-30">🗄</span>
                <p className="text-xs text-gray-500">Schema discovered when probe connects.</p>
              </div>
            )}
          </div>
        )}

        {/* ── CACHE ── */}
        {node.kind === "cache" && (
          <div className="p-4 space-y-3 text-xs">
            <div className="space-y-2">
              <div className="flex gap-3">
                <span className="text-gray-600 w-24 flex-shrink-0">Type</span>
                <span className="text-red-300 font-bold">Redis</span>
              </div>
              <div className="flex gap-3">
                <span className="text-gray-600 w-24 flex-shrink-0">Architecture</span>
                <span className="text-gray-400">In-memory key-value</span>
              </div>
              <div className="flex gap-3">
                <span className="text-gray-600 w-24 flex-shrink-0">Persistence</span>
                <span className="text-gray-400">RDB snapshots / AOF</span>
              </div>
              <div className="flex gap-3">
                <span className="text-gray-600 w-24 flex-shrink-0">Default port</span>
                <span className="text-gray-400 font-mono">6379</span>
              </div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5 mt-2">
              <p className="text-[11px] text-gray-500">
                Redis is used for session caching, rate limiting, pub/sub, and ephemeral data. No persistent schema.
              </p>
            </div>
          </div>
        )}

        {/* ── INTEGRATION (payment, email, storage, etc.) ── */}
        {!["database", "cache"].includes(node.kind) && (
          <div className="p-4 space-y-4 text-xs">
            <div className="space-y-2">
              <div className="flex gap-3">
                <span className="text-gray-600 w-24 flex-shrink-0">Kind</span>
                <span className="text-gray-300 capitalize" style={{ color: sc.title }}>{node.kind}</span>
              </div>
              <div className="flex gap-3">
                <span className="text-gray-600 w-24 flex-shrink-0">Service</span>
                <span className="text-gray-300">{node.name}</span>
              </div>
            </div>

            {/* Arch integration details */}
            {arch?.integrations?.filter(i => `int-${i.name}` === node.id).map(int_ => (
              <div key={int_.name} className="space-y-2">
                <div className="flex gap-3">
                  <span className="text-gray-600 w-24 flex-shrink-0">Env key</span>
                  <span className="font-mono text-green-400">{int_.env_key}</span>
                </div>
              </div>
            ))}

            <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5">
              <p className="text-[11px] text-gray-500">
                Discovered automatically from environment variable names on the probe host.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Client panel ──────────────────────────────────────────────────────────────

function ClientPanel({ node, schema, onClose }: {
  node: ClientNode; schema: ProbeExtendedData["api_schema"]; onClose: () => void;
}) {
  const authEndpoints  = schema?.endpoints?.filter(e => e.path.toLowerCase().includes("auth") || e.path.toLowerCase().includes("login")) ?? [];
  const totalEndpoints = schema?.endpoints?.length ?? 0;
  return (
    <div className="flex flex-col h-full">
      <PanelHeader title={node.label.replace(/^[^\s]+\s+/, "")} sub={node.sub} icon="👤" onClose={onClose} />
      <div className="p-4 space-y-4 text-xs">
        <div className="space-y-2">
          <div className="flex gap-3">
            <span className="text-gray-600 w-20 flex-shrink-0">Access via</span>
            <span className="text-gray-300">{node.sub}</span>
          </div>
          <div className="flex gap-3">
            <span className="text-gray-600 w-20 flex-shrink-0">Auth method</span>
            <span className="text-gray-300">{node.detail}</span>
          </div>
          {totalEndpoints > 0 && (
            <div className="flex gap-3">
              <span className="text-gray-600 w-20 flex-shrink-0">API surface</span>
              <span className="text-gray-300">{totalEndpoints} endpoints</span>
            </div>
          )}
        </div>
        {authEndpoints.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-widest text-gray-600">Auth Endpoints</p>
            {authEndpoints.slice(0, 6).map((ep, i) => (
              <div key={i} className="flex items-center gap-2">
                <MethodBadge method={ep.method} />
                <span className="font-mono text-[11px] text-gray-400 truncate">{ep.path}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── NodeDetailPanel router ─────────────────────────────────────────────────────

function NodeDetailPanel({ sel, frontends, infraNodes, routeGroups, clients, extended, schema, arch, hosting, runtime, onClose }: {
  sel: NonNullable<SelNode>;
  frontends: FrontendNode[]; infraNodes: InfraNode[];
  routeGroups: RouteGroup[]; clients: ClientNode[];
  extended: ProbeExtendedData | null;
  schema: ProbeExtendedData["api_schema"];
  arch: ProbeExtendedData["architecture"];
  hosting: string; runtime: string;
  onClose: () => void;
}) {
  if (sel.type === "frontend") {
    const node = frontends.find(f => f.id === sel.id);
    if (!node) return null;
    return <FrontendPanel node={node} extended={extended} onClose={onClose} />;
  }
  if (sel.type === "api") {
    return <APIPanel routeGroups={routeGroups} schema={schema} arch={arch} hosting={hosting} runtime={runtime} extended={extended} onClose={onClose} />;
  }
  if (sel.type === "infra") {
    const node = infraNodes.find(n => n.id === sel.id);
    if (!node) return null;
    return <InfraPanel node={node} extended={extended} arch={arch} onClose={onClose} />;
  }
  if (sel.type === "client") {
    const node = clients.find(c => c.id === sel.id);
    if (!node) return null;
    return <ClientPanel node={node} schema={schema} onClose={onClose} />;
  }
  return null;
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  system:   MonitoredSystem | SystemDetail;
  status:   ProbeStatusResponse | null;
  extended: ProbeExtendedData | null;
}

export function ArchitectureMap({ system, status, extended }: Props) {
  const arch   = extended?.architecture ?? null;
  const schema = extended?.api_schema   ?? null;
  const synths = extended?.synthetics   ?? [];
  const db     = extended?.database     ?? null;
  const topo   = status?.topology       ?? {};

  const [sel,       setSel]       = useState<SelNode>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { clients, frontends, routeGroups, infraNodes, edges, totalEndpoints } = useMemo(() => {
    const clientNodes: ClientNode[] = [
      { id: "users", label: "👤  Users", sub: "Browser / Mobile", detail: "WebAuthn · JWT" },
    ];
    const hasMerchants = schema?.endpoints?.some(e => e.path.includes("merchant"));
    const hasAdmin     = schema?.endpoints?.some(e => e.path.includes("admin"));
    if (hasMerchants) clientNodes.push({ id: "merchants", label: "🏪  Merchants", sub: "API Key Holders", detail: "Dashboard · Endpoints" });
    if (hasAdmin)     clientNodes.push({ id: "admin",     label: "🛡  Admin",     sub: "Internal only",  detail: "IP-restricted" });

    const fePageMap = new Map<string, FrontendPageInfo>();
    for (const fp of (extended?.frontends ?? [])) {
      try { fePageMap.set(new URL(fp.url).hostname, fp); } catch { /* */ }
    }
    const frontendMap = new Map<string, { url: string; status: string; latency?: number }>();
    for (const o of (arch?.cors_origins ?? [])) {
      try { frontendMap.set(new URL(o).hostname, { url: o, status: "unknown" }); } catch { /* */ }
    }
    for (const s of synths) {
      try { frontendMap.set(new URL(s.url).hostname, { url: s.url, status: s.status, latency: s.latency_ms }); } catch { /* */ }
    }
    const frontendNodes: FrontendNode[] = Array.from(frontendMap.entries()).map(([host, info]) => {
      const pages = fePageMap.get(host);
      return {
        id: `fe-${host}`, label: host, url: info.url, status: info.status, latency: info.latency,
        framework: pages?.framework ?? "",
        totalPages: pages?.total_pages ?? null,
        publicPages: pages?.public_pages ?? null,
        protectedPages: pages?.protected_pages ?? null,
      };
    });

    const tagMap = new Map<string, APIEndpoint[]>();
    for (const ep of (schema?.endpoints ?? [])) {
      const tag = ep.tags?.[0] ?? "general";
      tagMap.set(tag, [...(tagMap.get(tag) ?? []), ep]);
    }
    const groups: RouteGroup[] = Array.from(tagMap.entries()).map(([tag, eps]) => ({
      tag, endpoints: eps.slice(0, 5), total: eps.length, color: tagColor(tag),
    }));

    const infra: InfraNode[] = [];
    const subServices = ("sub_services" in system ? system.sub_services : null) ?? [];
    for (const svc of subServices) {
      const k = svc.kind.toLowerCase();
      if (k.includes("database") || k.includes("postgres") || k.includes("sql") || k.includes("mongo")) {
        let dbSub = svc.kind;
        if (db?.connected) {
          const tc = db.tables?.length ?? 0;
          const sz = db.size_bytes ? (db.size_bytes / 1_048_576).toFixed(1) : null;
          dbSub = sz ? `${tc} tables · ${sz} MB` : `${tc} tables`;
        }
        infra.push({ id: `svc-${svc.name}`, name: svc.name, kind: "database", icon: "🗄", sub: dbSub, status: svc.status, latency: svc.latency_ms });
      } else if (k.includes("redis") || k.includes("cache")) {
        infra.push({ id: `svc-${svc.name}`, name: svc.name, kind: "cache", icon: "⚡", sub: "in-memory cache", status: svc.status, latency: svc.latency_ms });
      }
    }
    if (db?.connected && !infra.find(n => n.kind === "database")) {
      const tc = db.tables?.length ?? 0;
      const sz = db.size_bytes ? (db.size_bytes / 1_048_576).toFixed(1) : null;
      infra.push({ id: "db-main", name: db.db_name ?? "PostgreSQL", kind: "database", icon: "🗄", sub: sz ? `${tc} tables · ${sz} MB` : `${tc} tables`, status: "up" });
    }
    const seen = new Set(infra.map(n => n.id));
    for (const int_ of (arch?.integrations ?? [])) {
      const id = `int-${int_.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      infra.push({ id, name: int_.name, kind: int_.kind, icon: int_.icon ?? "⚙", sub: int_.kind });
    }

    const edges_: { from: string; to: string; color: string; dashed?: boolean }[] = [];
    for (const c of clientNodes) for (const f of frontendNodes) edges_.push({ from: c.id, to: f.id, color: "#334155", dashed: true });
    if (frontendNodes.length === 0) for (const c of clientNodes) edges_.push({ from: c.id, to: "api", color: "#6366f1" });
    for (const f of frontendNodes) edges_.push({ from: f.id, to: "api", color: "#6366f1" });
    for (const n of infra) edges_.push({ from: "api", to: n.id, color: C.infra[n.kind]?.border ?? C.infra.default.border });

    return { clients: clientNodes, frontends: frontendNodes, routeGroups: groups, infraNodes: infra, edges: edges_, totalEndpoints: schema?.endpoints?.length ?? 0 };
  }, [system, arch, schema, synths, db, extended]);

  const clientPositions   = row(clients.map(n => n.id),    NODE_W.client,   LAYER.clients.y);
  const frontendPositions = row(frontends.map(n => n.id),  NODE_W.frontend, LAYER.frontends.y);
  const infraPositions    = row(infraNodes.map(n => n.id), NODE_W.infra,    LAYER.infra.y);

  const API_X = PAD;
  const API_W = W - 2 * PAD;

  function nodeCenter(id: string) {
    if (id === "api") return { x: API_X + API_W / 2, y: LAYER.api.y + LAYER.api.h / 2, bottom: LAYER.api.y + LAYER.api.h, top: LAYER.api.y };
    for (const pos of [...clientPositions, ...frontendPositions, ...infraPositions]) {
      if (pos.id !== id) continue;
      const isC = clients.some(n => n.id === id);
      const isF = frontends.some(n => n.id === id);
      const h  = isC ? LAYER.clients.h  : isF ? LAYER.frontends.h : LAYER.infra.h;
      const nw = isC ? NODE_W.client    : isF ? NODE_W.frontend   : NODE_W.infra;
      return { x: pos.x + nw / 2, y: pos.y + h / 2, bottom: pos.y + h, top: pos.y };
    }
    return { x: 0, y: 0, bottom: 0, top: 0 };
  }

  const arrowColors = [...new Set(edges.map(e => e.color))];
  const RG_PAD = 14;
  const RG_H   = LAYER.api.h - 60;
  const rgCount = routeGroups.length;
  const RG_W   = rgCount > 0 ? Math.min(220, Math.floor((API_W - 2 * RG_PAD - (rgCount - 1) * 10) / rgCount)) : 0;
  const rgGap  = rgCount > 1 ? Math.max(6, (API_W - 2 * RG_PAD - rgCount * RG_W) / (rgCount - 1)) : 0;

  const hosting  = arch?.hosting ?? "";
  const runtime  = arch?.runtime ?? (topo.os ? `${topo.os} / ${topo.arch ?? ""}` : "");
  const apiTitle = schema?.title ?? system.name;

  function select(id: string, type: NonNullable<SelNode>["type"]) {
    setSel(prev => (prev?.id === id ? null : { id, type }));
  }

  const selRing = (x: number, y: number, w: number, h: number, r = 10) =>
    sel ? <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={r + 2} fill="none" stroke="#6366f1" strokeWidth={2.5} opacity={0.9} /> : null;

  return (
    <div className="rounded-xl border border-gray-800 bg-[#09090b] flex overflow-hidden">

      {/* ── SVG section ───────────────────────────────────────────────────── */}
      <div className={`${sel ? "flex-1 min-w-0" : "w-full"} overflow-x-auto transition-all`}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ minWidth: 520, display: "block", fontFamily: "'ui-monospace','monospace'" }}
          aria-label="System architecture diagram"
          onClick={() => setSel(null)}
        >
          <defs>
            {arrowColors.map(c => (
              <marker key={c} id={`arr-${c.replace("#", "")}`} markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L7,3z" fill={c} />
              </marker>
            ))}
          </defs>

          {/* Layer rails */}
          {[
            { y: LAYER.clients.y,   h: LAYER.clients.h,   label: "CLIENTS"   },
            { y: LAYER.frontends.y, h: LAYER.frontends.h, label: "FRONTENDS" },
            { y: LAYER.api.y,       h: LAYER.api.h,       label: "API"       },
            { y: LAYER.infra.y,     h: LAYER.infra.h,     label: "INFRA"     },
          ].map(({ y, h, label }) => (
            <g key={label}>
              <rect x={1} y={y} width={2} height={h} fill="#1e293b" />
              <text x={10} y={y + 20} fontSize={8} fill="#334155" letterSpacing={2.5}>{label}</text>
            </g>
          ))}

          {/* Edges */}
          {edges.map((e, i) => {
            const from = nodeCenter(e.from);
            const to   = nodeCenter(e.to);
            return (
              <path key={i}
                d={`M${from.x},${from.bottom} C${from.x},${(from.bottom + to.top) / 2} ${to.x},${(from.bottom + to.top) / 2} ${to.x},${to.top}`}
                fill="none" stroke={e.color}
                strokeWidth={e.dashed ? 1.2 : 1.8}
                strokeDasharray={e.dashed ? "5,3" : undefined}
                opacity={e.dashed ? 0.45 : 0.7}
                markerEnd={`url(#arr-${e.color.replace("#", "")})`}
              />
            );
          })}

          {/* CLIENT NODES */}
          {clientPositions.map((pos) => {
            const node = clients.find(n => n.id === pos.id)!;
            const isSelected = sel?.id === pos.id;
            const isHovered  = hoveredId === pos.id;
            return (
              <g key={pos.id} style={{ cursor: "pointer" }} opacity={isHovered || isSelected ? 1 : 0.88}
                onClick={e => { e.stopPropagation(); select(pos.id, "client"); }}
                onMouseEnter={() => setHoveredId(pos.id)} onMouseLeave={() => setHoveredId(null)}>
                {isSelected && selRing(pos.x, pos.y, NODE_W.client, LAYER.clients.h)}
                <rect x={pos.x} y={pos.y} width={NODE_W.client} height={LAYER.clients.h} rx={10} fill={C.client.bg} stroke={isSelected ? "#6366f1" : C.client.border} strokeWidth={isSelected ? 2 : 1.5} />
                <rect x={pos.x} y={pos.y} width={NODE_W.client} height={4} rx={2} fill={isSelected ? "#6366f1" : C.client.border} />
                <text x={pos.x + NODE_W.client / 2} y={pos.y + 28} fontSize={11} fontWeight={700} fill={C.client.title} textAnchor="middle">{node.label}</text>
                <text x={pos.x + NODE_W.client / 2} y={pos.y + 46} fontSize={8.5} fill="#475569" textAnchor="middle">{node.sub}</text>
                <text x={pos.x + NODE_W.client / 2} y={pos.y + 62} fontSize={8} fill="#334155" textAnchor="middle">{node.detail}</text>
              </g>
            );
          })}

          {/* FRONTEND NODES */}
          {frontendPositions.map((pos) => {
            const node = frontends.find(n => n.id === pos.id)!;
            const sc   = C.frontend[node.status as keyof typeof C.frontend] ?? C.frontend.unknown;
            const isSelected = sel?.id === pos.id;
            const isHovered  = hoveredId === pos.id;
            const hasPages   = node.totalPages != null && node.totalPages > 0;
            return (
              <g key={pos.id} style={{ cursor: "pointer" }} opacity={isHovered || isSelected ? 1 : 0.88}
                onClick={e => { e.stopPropagation(); select(pos.id, "frontend"); }}
                onMouseEnter={() => setHoveredId(pos.id)} onMouseLeave={() => setHoveredId(null)}>
                {isSelected && selRing(pos.x, pos.y, NODE_W.frontend, LAYER.frontends.h)}
                <rect x={pos.x} y={pos.y} width={NODE_W.frontend} height={LAYER.frontends.h} rx={10} fill={sc.bg} stroke={isSelected ? "#6366f1" : sc.border} strokeWidth={isSelected ? 2 : 1.5} />
                <rect x={pos.x} y={pos.y} width={NODE_W.frontend} height={4} rx={2} fill={isSelected ? "#6366f1" : sc.border} />
                <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 24} fontSize={10} fontWeight={700} fill={sc.title} textAnchor="middle">{node.label}</text>
                {node.framework
                  ? <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 40} fontSize={8} fill={FW_COLOR[node.framework] ?? "#6366f1"} textAnchor="middle" fontWeight={600}>{node.framework}</text>
                  : <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 40} fontSize={7.5} fill="#334155" textAnchor="middle">detecting framework…</text>
                }
                {hasPages ? (
                  <>
                    <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 58} fontSize={8} fill="#94a3b8" textAnchor="middle">{node.totalPages} pages</text>
                    <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 73} fontSize={7.5} textAnchor="middle">
                      <tspan fill="#22c55e">● {node.publicPages} public</tspan>{"  "}
                      <tspan fill="#f59e0b">🔒 {node.protectedPages} auth</tspan>
                    </text>
                  </>
                ) : (
                  <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 63} fontSize={7.5} fill="#334155" textAnchor="middle">pages collecting…</text>
                )}
                <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 92} fontSize={7.5} fill="#475569" textAnchor="middle">
                  {node.latency != null ? `${node.latency.toFixed(0)} ms · ` : ""}{node.status}
                </text>
                <line x1={pos.x + 12} y1={pos.y + 100} x2={pos.x + NODE_W.frontend - 12} y2={pos.y + 100} stroke="#1e293b" strokeWidth={1} />
                <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 116} fontSize={6.5} fill="#334155" textAnchor="middle">
                  {node.url.length > 34 ? node.url.slice(0, 34) + "…" : node.url}
                </text>
                {/* "click for details" hint on hover */}
                {isHovered && !isSelected && (
                  <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 130} fontSize={7} fill="#6366f1" textAnchor="middle">click for details</text>
                )}
                <circle cx={pos.x + NODE_W.frontend - 14} cy={pos.y + 16} r={4} fill={sc.border} opacity={0.8} />
              </g>
            );
          })}

          {/* API BOX */}
          <g style={{ cursor: "pointer" }}
            onClick={e => { e.stopPropagation(); select("api", "api"); }}
            onMouseEnter={() => setHoveredId("api")} onMouseLeave={() => setHoveredId(null)}>
            {sel?.id === "api" && selRing(API_X, LAYER.api.y, API_W, LAYER.api.h, 14)}
            <rect x={API_X} y={LAYER.api.y} width={API_W} height={LAYER.api.h} rx={14} fill={C.api.bg} stroke={sel?.id === "api" ? "#6366f1" : C.api.border} strokeWidth={sel?.id === "api" ? 2 : 1.5} opacity={hoveredId === "api" || sel?.id === "api" ? 1 : 0.9} />
            <rect x={API_X} y={LAYER.api.y} width={API_W} height={4} rx={2} fill={sel?.id === "api" ? "#6366f1" : C.api.border} />
            <text x={API_X + 18} y={LAYER.api.y + 24} fontSize={11} fontWeight={700} fill={C.api.title}>{apiTitle}</text>
            {hosting && <text x={API_X + 18} y={LAYER.api.y + 38} fontSize={8} fill="#6366f1">{HOSTING_ICON[hosting] ?? "🏠"} {hosting}</text>}
            {runtime  && <text x={API_X + (hosting ? 120 : 18)} y={LAYER.api.y + 38} fontSize={8} fill="#475569">{runtime}</text>}
            {totalEndpoints > 0 && (
              <text x={API_X + 18} y={LAYER.api.y + 50} fontSize={7.5} fill="#475569">
                <tspan fill="#6366f1" fontWeight={600}>{totalEndpoints}</tspan>{" endpoints"}
                {schema?.version ? <tspan fill="#334155">  ·  v{schema.version}</tspan> : null}
              </text>
            )}
            <text x={API_X + API_W - 18} y={LAYER.api.y + 24} fontSize={8} fill="#334155" textAnchor="end">
              {(() => { try { return new URL(system.url).hostname; } catch { return system.url; } })()}
            </text>
            {hoveredId === "api" && sel?.id !== "api" && (
              <text x={API_X + API_W / 2} y={LAYER.api.y + 50} fontSize={7} fill="#6366f1" textAnchor="middle">click for details</text>
            )}
          </g>

          {/* ROUTE GROUP sub-boxes (non-interactive — clicking selects the API box) */}
          {rgCount > 0 && routeGroups.map((rg, i) => {
            const rx_ = API_X + RG_PAD + i * (RG_W + rgGap);
            const ry_ = LAYER.api.y + 58;
            return (
              <g key={rg.tag} style={{ pointerEvents: "none" }}>
                <rect x={rx_} y={ry_} width={RG_W} height={RG_H} rx={7} fill="#0e0e1a" stroke={rg.color} strokeWidth={1} />
                <rect x={rx_} y={ry_} width={RG_W} height={3} rx={1.5} fill={rg.color} />
                <text x={rx_ + RG_W / 2} y={ry_ + 16} fontSize={9.5} fontWeight={700} fill={rg.color} textAnchor="middle">/{rg.tag}/*</text>
                {rg.endpoints.slice(0, 4).map((ep, j) => (
                  <text key={j} x={rx_ + RG_W / 2} y={ry_ + 30 + j * 14} fontSize={7.5} fill="#475569" textAnchor="middle">
                    <tspan fill={ep.method === "GET" ? "#22c55e" : ep.method === "POST" ? "#3b82f6" : ep.method === "DELETE" ? "#ef4444" : ep.method === "PATCH" ? "#f97316" : "#94a3b8"}>{ep.method}</tspan>
                    {" "}{ep.path.length > 18 ? ep.path.slice(0, 18) + "…" : ep.path}
                  </text>
                ))}
                {rg.total > 4 && <text x={rx_ + RG_W / 2} y={ry_ + RG_H - 8} fontSize={7} fill="#334155" textAnchor="middle">+{rg.total - 4} more</text>}
              </g>
            );
          })}

          {rgCount === 0 && (
            <text x={API_X + API_W / 2} y={LAYER.api.y + LAYER.api.h / 2 + 14} fontSize={9} fill="#334155" textAnchor="middle" style={{ pointerEvents: "none" }}>
              Set OPENWATCH_SERVICE_URL on probe to discover API endpoints
            </text>
          )}

          {/* INFRA NODES */}
          {infraPositions.map((pos) => {
            const node = infraNodes.find(n => n.id === pos.id)!;
            const sc   = C.infra[node.kind] ?? C.infra.default;
            const statusDot = node.status === "up" ? "#22c55e" : node.status === "down" ? "#ef4444" : node.status === "degraded" ? "#f59e0b" : undefined;
            const isSelected = sel?.id === pos.id;
            const isHovered  = hoveredId === pos.id;
            return (
              <g key={pos.id} style={{ cursor: "pointer" }} opacity={isHovered || isSelected ? 1 : 0.88}
                onClick={e => { e.stopPropagation(); select(pos.id, "infra"); }}
                onMouseEnter={() => setHoveredId(pos.id)} onMouseLeave={() => setHoveredId(null)}>
                {isSelected && selRing(pos.x, pos.y, NODE_W.infra, LAYER.infra.h)}
                <rect x={pos.x} y={pos.y} width={NODE_W.infra} height={LAYER.infra.h} rx={10} fill={sc.bg} stroke={isSelected ? "#6366f1" : sc.border} strokeWidth={isSelected ? 2 : 1.5} />
                <rect x={pos.x} y={pos.y} width={NODE_W.infra} height={4} rx={2} fill={isSelected ? "#6366f1" : sc.border} />
                <text x={pos.x + NODE_W.infra / 2} y={pos.y + 28} fontSize={12} textAnchor="middle">{node.icon}</text>
                <text x={pos.x + NODE_W.infra / 2} y={pos.y + 46} fontSize={10} fontWeight={700} fill={sc.title} textAnchor="middle">{node.name}</text>
                <text x={pos.x + NODE_W.infra / 2} y={pos.y + 60} fontSize={8} fill="#475569" textAnchor="middle">{node.sub}</text>
                {node.latency != null && <text x={pos.x + NODE_W.infra / 2} y={pos.y + 74} fontSize={8} fill="#475569" textAnchor="middle">{node.latency.toFixed(0)} ms</text>}
                {isHovered && !isSelected && <text x={pos.x + NODE_W.infra / 2} y={pos.y + 110} fontSize={7} fill="#6366f1" textAnchor="middle">click for details</text>}
                {statusDot && <circle cx={pos.x + NODE_W.infra - 14} cy={pos.y + 16} r={4} fill={statusDot} opacity={0.9} />}
              </g>
            );
          })}

          {/* Bottom bar */}
          <text x={W / 2} y={H - 12} fontSize={8} fill="#1e293b" textAnchor="middle" letterSpacing={2.5} style={{ pointerEvents: "none" }}>
            OPENWATCH AUTO-DISCOVERY  ·  {system.name.toUpperCase()}  ·  {new Date().toLocaleDateString()}
          </text>
          {frontends.length === 0 && (
            <text x={W / 2} y={LAYER.frontends.y + 50} fontSize={9} fill="#1e293b" textAnchor="middle" letterSpacing={1} style={{ pointerEvents: "none" }}>
              FRONTEND URLS COLLECTING… (auto-discovered from CORS headers each 5 min)
            </text>
          )}
          {routeGroups.length === 0 && (
            <text x={API_X + API_W / 2} y={LAYER.api.y + LAYER.api.h / 2} fontSize={9} fill="#1e293b" textAnchor="middle" letterSpacing={1} style={{ pointerEvents: "none" }}>
              API ENDPOINTS COLLECTING… (OpenAPI discovery runs each 5 min)
            </text>
          )}
        </svg>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 px-5 py-3 border-t border-gray-800 text-[11px] font-mono text-gray-600">
          {[
            { color: "#3b82f6", label: "Clients / DB" }, { color: "#6366f1", label: "API service" },
            { color: "#22c55e", label: "Up / Payments" }, { color: "#a855f7", label: "Email / Merchant" },
            { color: "#ef4444", label: "Down / Cache" },  { color: "#f59e0b", label: "Degraded" },
            { color: "#06b6d4", label: "AI / Realtime" }, { color: "#334155", label: "Admin / VCS" },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="w-5 h-0.5 rounded-full" style={{ background: color }} />
              {label}
            </span>
          ))}
          {sel && (
            <span className="ml-auto text-[10px] text-indigo-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
              click background to deselect
            </span>
          )}
        </div>
      </div>

      {/* ── Detail panel ──────────────────────────────────────────────────── */}
      {sel && (
        <div
          className="w-80 xl:w-96 border-l border-gray-800 flex-shrink-0 overflow-y-auto bg-[#0d0d12]"
          style={{ maxHeight: 700 }}
        >
          <NodeDetailPanel
            sel={sel}
            frontends={frontends}
            infraNodes={infraNodes}
            routeGroups={routeGroups}
            clients={clients}
            extended={extended}
            schema={schema}
            arch={arch}
            hosting={hosting}
            runtime={runtime}
            onClose={() => setSel(null)}
          />
        </div>
      )}
    </div>
  );
}
