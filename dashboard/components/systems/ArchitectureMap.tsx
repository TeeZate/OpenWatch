"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useMemo } from "react";
import type {
  MonitoredSystem,
  SystemDetail,
  ProbeStatusResponse,
  ProbeExtendedData,
  APIEndpoint,
  FrontendPageInfo,
} from "@/lib/api";

// ── Layout constants ──────────────────────────────────────────────────────────

const W  = 1400;  // SVG viewBox width
const H  = 860;   // SVG viewBox height
const PAD = 44;   // horizontal padding

const LAYER = {
  clients:   { y: 22,  h: 88  },
  frontends: { y: 158, h: 140 },   // taller — fits framework + page breakdown
  api:       { y: 350, h: 210 },
  infra:     { y: 616, h: 120 },
};

const NODE_W = {
  client:   176,
  frontend: 210,   // slightly wider for page info
  infra:    184,
};

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

// tag → colour for route group boxes inside the API layer
const TAG_COLOR: Record<string, string> = {
  auth:        "#3b82f6",
  users:       "#22c55e",
  user:        "#22c55e",
  merchants:   "#a855f7",
  merchant:    "#a855f7",
  marketplace: "#f59e0b",
  wallet:      "#22c55e",
  payment:     "#22c55e",
  admin:       "#475569",
  health:      "#06b6d4",
  products:    "#f97316",
  orders:      "#ec4899",
  webhooks:    "#94a3b8",
  default:     "#475569",
};

function tagColor(tag: string): string {
  const key = tag.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, v] of Object.entries(TAG_COLOR)) {
    if (key.includes(k)) return v;
  }
  return TAG_COLOR.default;
}

const HOSTING_ICON: Record<string, string> = {
  "Railway": "🚂", "Fly.io": "🪁", "Render": "🖥",
  "Heroku": "💜", "AWS": "☁", "Vercel": "▲",
  "Cloud Run": "☁", "Netlify": "🌐",
};

// ── Layout helper ─────────────────────────────────────────────────────────────

function row(
  items: string[],
  nodeW: number,
  y: number,
): { id: string; x: number; y: number }[] {
  if (items.length === 0) return [];
  const usable = W - 2 * PAD;
  const gap = items.length === 1
    ? 0
    : Math.max(10, (usable - items.length * nodeW) / (items.length - 1));
  const totalUsed = items.length * nodeW + (items.length - 1) * gap;
  const startX = PAD + (usable - totalUsed) / 2;
  return items.map((id, i) => ({
    id,
    x: startX + i * (nodeW + gap),
    y,
  }));
}

// ── Bezier arrow helper ───────────────────────────────────────────────────────

function bezier(
  x1: number, y1: number,
  x2: number, y2: number,
  color: string,
  dashed = false,
): React.ReactElement {
  const mid = (y1 + y2) / 2;
  const d = `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`;
  return (
    <path
      key={`${x1}-${y1}-${x2}-${y2}`}
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeDasharray={dashed ? "5,3" : undefined}
      opacity={dashed ? 0.55 : 0.75}
      markerEnd={`url(#arr-${color.replace("#", "")})`}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  system:   MonitoredSystem | SystemDetail;
  status:   ProbeStatusResponse | null;
  extended: ProbeExtendedData | null;
}

export function ArchitectureMap({ system, status, extended }: Props) {
  const arch    = extended?.architecture ?? null;
  const schema  = extended?.api_schema   ?? null;
  const synths  = extended?.synthetics   ?? [];
  const db      = extended?.database     ?? null;
  const topo    = status?.topology       ?? {};

  // ── Build node data ─────────────────────────────────────────────────────────

  const {
    clients, frontends, routeGroups, infraNodes, edges, totalEndpoints,
  } = useMemo(() => {

    // CLIENT nodes
    const clientNodes = [
      { id: "users",    label: "👤  Users",     sub: "Browser / Mobile",   detail: "WebAuthn · JWT" },
    ];
    // Add merchant if API has /merchants route
    const hasMerchants = schema?.endpoints?.some(e => e.path.includes("merchant"));
    const hasAdmin     = schema?.endpoints?.some(e => e.path.includes("admin"));
    if (hasMerchants) clientNodes.push({ id: "merchants", label: "🏪  Merchants", sub: "API Key Holders", detail: "Dashboard · Endpoints" });
    if (hasAdmin)     clientNodes.push({ id: "admin",     label: "🛡  Admin",     sub: "Internal only",  detail: "IP-restricted" });

    // FRONTEND nodes — CORS origins + synthetic checks (deduped) + page info
    const fePageMap = new Map<string, FrontendPageInfo>();
    for (const fp of (extended?.frontends ?? [])) {
      try { fePageMap.set(new URL(fp.url).hostname, fp); } catch { /* ignore */ }
    }

    const frontendMap = new Map<string, { url: string; status: string; latency?: number }>();
    for (const origin of (arch?.cors_origins ?? [])) {
      try { frontendMap.set(new URL(origin).hostname, { url: origin, status: "unknown" }); } catch { /* ignore */ }
    }
    for (const s of synths) {
      try { frontendMap.set(new URL(s.url).hostname, { url: s.url, status: s.status, latency: s.latency_ms }); } catch { /* ignore */ }
    }
    const frontendNodes = Array.from(frontendMap.entries()).map(([host, info]) => {
      const pages = fePageMap.get(host);
      return {
        id:        `fe-${host}`,
        label:     host,
        url:       info.url,
        status:    info.status,
        latency:   info.latency,
        framework: pages?.framework ?? "",
        totalPages:     pages?.total_pages     ?? null,
        publicPages:    pages?.public_pages    ?? null,
        protectedPages: pages?.protected_pages ?? null,
      };
    });

    // ROUTE GROUP nodes (inside API layer)
    const tagMap = new Map<string, APIEndpoint[]>();
    for (const ep of (schema?.endpoints ?? [])) {
      const tag = ep.tags?.[0] ?? "general";
      const list = tagMap.get(tag) ?? [];
      list.push(ep);
      tagMap.set(tag, list);
    }
    const groups = Array.from(tagMap.entries()).map(([tag, eps]) => ({
      tag,
      endpoints: eps.slice(0, 5),
      total: eps.length,
      color: tagColor(tag),
    }));

    // INFRA nodes
    const infra: { id: string; name: string; kind: string; icon: string; sub: string; status?: string; latency?: number }[] = [];

    // Database / cache from probe service checks (populated once detail is loaded)
    const subServices = ("sub_services" in system ? system.sub_services : null) ?? [];
    for (const svc of subServices) {
      const k = svc.kind.toLowerCase();
      if (k.includes("database") || k.includes("postgres") || k.includes("sql") || k.includes("mongo")) {
        // Enrich DB sub with table count + size from extended data if available
        let dbSub = svc.kind;
        if (db?.connected) {
          const tableCount = db.tables?.length ?? 0;
          const dbSizeMB   = db.size_bytes ? (db.size_bytes / 1_048_576).toFixed(1) : null;
          dbSub = dbSizeMB ? `${tableCount} tables · ${dbSizeMB} MB` : `${tableCount} tables`;
        }
        infra.push({ id: `svc-${svc.name}`, name: svc.name, kind: "database", icon: "🗄", sub: dbSub, status: svc.status, latency: svc.latency_ms });
      } else if (k.includes("redis") || k.includes("cache")) {
        infra.push({ id: `svc-${svc.name}`, name: svc.name, kind: "cache",    icon: "⚡", sub: "in-memory cache", status: svc.status, latency: svc.latency_ms });
      }
    }

    // If DB from extended schema and not already listed
    if (db?.connected && !infra.find(n => n.kind === "database")) {
      const tableCount = db.tables?.length ?? 0;
      const dbSizeMB   = db.size_bytes ? (db.size_bytes / 1_048_576).toFixed(1) : null;
      const dbSub      = dbSizeMB ? `${tableCount} tables · ${dbSizeMB} MB` : `${tableCount} tables`;
      infra.push({ id: "db-main", name: db.db_name ?? "PostgreSQL", kind: "database", icon: "🗄", sub: dbSub, status: "up" });
    }

    // External integrations from arch discovery
    const seen = new Set(infra.map(n => n.id));
    for (const int_ of (arch?.integrations ?? [])) {
      const id = `int-${int_.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      infra.push({ id, name: int_.name, kind: int_.kind, icon: int_.icon ?? "⚙", sub: int_.kind });
    }

    // ── Edges ──────────────────────────────────────────────────────────────────
    const edges_: { from: string; to: string; color: string; dashed?: boolean }[] = [];

    // clients → frontends
    for (const c of clientNodes) {
      for (const f of frontendNodes) {
        edges_.push({ from: c.id, to: f.id, color: "#334155", dashed: true });
      }
    }

    // clients → api (if no frontends)
    if (frontendNodes.length === 0) {
      for (const c of clientNodes) {
        edges_.push({ from: c.id, to: "api", color: "#6366f1", dashed: false });
      }
    }

    // frontends → api
    for (const f of frontendNodes) {
      edges_.push({ from: f.id, to: "api", color: "#6366f1", dashed: false });
    }

    // api → infra
    for (const n of infra) {
      const col = C.infra[n.kind]?.border ?? C.infra.default.border;
      edges_.push({ from: "api", to: n.id, color: col, dashed: false });
    }

    const totalEndpoints = schema?.endpoints?.length ?? 0;

    return {
      clients:       clientNodes,
      frontends:     frontendNodes,
      routeGroups:   groups,
      infraNodes:    infra,
      edges:         edges_,
      totalEndpoints,
    };
  }, [system, arch, schema, synths, db, extended]);

  // ── Calculate positions ─────────────────────────────────────────────────────

  const clientPositions  = row(clients.map(n => n.id),   NODE_W.client,   LAYER.clients.y);
  const frontendPositions= row(frontends.map(n => n.id), NODE_W.frontend, LAYER.frontends.y);
  const infraPositions   = row(infraNodes.map(n => n.id),NODE_W.infra,    LAYER.infra.y);

  // API box spans full width
  const API_X = PAD;
  const API_W = W - 2 * PAD;

  // ── Node lookup by id ───────────────────────────────────────────────────────
  function nodeCenter(id: string): { x: number; y: number; bottom: number; top: number } {
    if (id === "api") return {
      x: API_X + API_W / 2,
      y: LAYER.api.y + LAYER.api.h / 2,
      bottom: LAYER.api.y + LAYER.api.h,
      top: LAYER.api.y,
    };
    for (const pos of [...clientPositions, ...frontendPositions, ...infraPositions]) {
      if (pos.id === id) {
        const isClient = clients.some(n => n.id === id);
        const isFrontend = frontends.some(n => n.id === id);
        const h = isClient ? LAYER.clients.h : isFrontend ? LAYER.frontends.h : LAYER.infra.h;
        const nw = isClient ? NODE_W.client : isFrontend ? NODE_W.frontend : NODE_W.infra;
        return {
          x:      pos.x + nw / 2,
          y:      pos.y + h / 2,
          bottom: pos.y + h,
          top:    pos.y,
        };
      }
    }
    return { x: 0, y: 0, bottom: 0, top: 0 };
  }

  // ── Collect unique arrow colors for defs ────────────────────────────────────
  const arrowColors = [...new Set(edges.map(e => e.color))];

  // ── Route group layout inside API box ──────────────────────────────────────
  const RG_PAD   = 14;
  const RG_H     = LAYER.api.h - 60;  // leave room for the taller header
  const rgCount  = routeGroups.length;
  const RG_W     = rgCount > 0
    ? Math.min(220, Math.floor((API_W - 2 * RG_PAD - (rgCount - 1) * 10) / rgCount))
    : 0;
  const rgGap    = rgCount > 1
    ? Math.max(6, (API_W - 2 * RG_PAD - rgCount * RG_W) / (rgCount - 1))
    : 0;

  // ── Hosting + runtime badge text ────────────────────────────────────────────
  const hosting = arch?.hosting ?? "";
  const runtime = arch?.runtime ?? (topo.os ? `${topo.os} / ${topo.arch ?? ""}` : "");
  const apiTitle = schema?.title ?? system.name;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-gray-800 bg-[#09090b]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ minWidth: 700, display: "block", fontFamily: "'ui-monospace','monospace'" }}
        aria-label="System architecture diagram"
      >
        {/* ── Arrow marker defs ────────────────────────────────────────── */}
        <defs>
          {arrowColors.map(c => (
            <marker
              key={c}
              id={`arr-${c.replace("#", "")}`}
              markerWidth="7" markerHeight="7"
              refX="5" refY="3" orient="auto"
            >
              <path d="M0,0 L0,6 L7,3z" fill={c} />
            </marker>
          ))}
        </defs>

        {/* ── Background layer rails ───────────────────────────────────── */}
        {[
          { y: LAYER.clients.y,   label: "CLIENTS"  },
          { y: LAYER.frontends.y, label: "FRONTENDS" },
          { y: LAYER.api.y,       label: "API"       },
          { y: LAYER.infra.y,     label: "INFRA"     },
        ].map(({ y, label }) => (
          <g key={label}>
            <rect x={1} y={y} width={2} height={label === "API" ? LAYER.api.h : 100} fill="#1e293b" />
            <text x={10} y={y + 20} fontSize={8} fill="#334155" letterSpacing={2.5}>{label}</text>
          </g>
        ))}

        {/* ── Connecting arrows (draw first, behind nodes) ─────────────── */}
        {edges.map((e, i) => {
          const from = nodeCenter(e.from);
          const to   = nodeCenter(e.to);
          // Bottom of upper node → top of lower node
          return (
            <path
              key={i}
              d={`M${from.x},${from.bottom} C${from.x},${(from.bottom + to.top) / 2} ${to.x},${(from.bottom + to.top) / 2} ${to.x},${to.top}`}
              fill="none"
              stroke={e.color}
              strokeWidth={e.dashed ? 1.2 : 1.8}
              strokeDasharray={e.dashed ? "5,3" : undefined}
              opacity={e.dashed ? 0.45 : 0.7}
              markerEnd={`url(#arr-${e.color.replace("#", "")})`}
            />
          );
        })}

        {/* ── CLIENT NODES ────────────────────────────────────────────────── */}
        {clientPositions.map((pos) => {
          const node = clients.find(n => n.id === pos.id)!;
          return (
            <g key={pos.id}>
              <rect x={pos.x} y={pos.y} width={NODE_W.client} height={LAYER.clients.h}
                rx={10} fill={C.client.bg} stroke={C.client.border} strokeWidth={1.5} />
              <rect x={pos.x} y={pos.y} width={NODE_W.client} height={4} rx={2} fill={C.client.border} />
              <text x={pos.x + NODE_W.client / 2} y={pos.y + 28}
                fontSize={11} fontWeight={700} fill={C.client.title} textAnchor="middle">{node.label}</text>
              <text x={pos.x + NODE_W.client / 2} y={pos.y + 46}
                fontSize={8.5} fill="#475569" textAnchor="middle">{node.sub}</text>
              <text x={pos.x + NODE_W.client / 2} y={pos.y + 62}
                fontSize={8} fill="#334155" textAnchor="middle">{node.detail}</text>
            </g>
          );
        })}

        {/* ── FRONTEND NODES ──────────────────────────────────────────────── */}
        {frontendPositions.map((pos) => {
          const node = frontends.find(n => n.id === pos.id)!;
          const sc   = C.frontend[node.status as keyof typeof C.frontend] ?? C.frontend.unknown;
          const hasPages = node.totalPages != null && node.totalPages > 0;
          return (
            <g key={pos.id}>
              <rect x={pos.x} y={pos.y} width={NODE_W.frontend} height={LAYER.frontends.h}
                rx={10} fill={sc.bg} stroke={sc.border} strokeWidth={1.5} />
              <rect x={pos.x} y={pos.y} width={NODE_W.frontend} height={4} rx={2} fill={sc.border} />

              {/* Hostname */}
              <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 24}
                fontSize={10} fontWeight={700} fill={sc.title} textAnchor="middle">{node.label}</text>

              {/* Framework badge */}
              {node.framework ? (
                <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 40}
                  fontSize={8} fill="#6366f1" textAnchor="middle" fontWeight={600}>
                  {node.framework}
                </text>
              ) : (
                <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 40}
                  fontSize={7.5} fill="#334155" textAnchor="middle">detecting framework…</text>
              )}

              {/* Page breakdown */}
              {hasPages ? (
                <>
                  <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 58}
                    fontSize={8} fill="#94a3b8" textAnchor="middle">
                    {node.totalPages} pages discovered
                  </text>
                  <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 73}
                    fontSize={7.5} textAnchor="middle">
                    <tspan fill="#22c55e">● {node.publicPages} public</tspan>
                    {"  "}
                    <tspan fill="#f59e0b">🔒 {node.protectedPages} auth</tspan>
                  </text>
                </>
              ) : (
                <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 63}
                  fontSize={7.5} fill="#334155" textAnchor="middle">pages collecting…</text>
              )}

              {/* Latency + status */}
              <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 92}
                fontSize={7.5} fill="#475569" textAnchor="middle" fontFamily="ui-monospace,monospace">
                {node.latency != null ? `${node.latency.toFixed(0)} ms · ` : ""}{node.status}
              </text>

              {/* Divider line */}
              <line x1={pos.x + 12} y1={pos.y + 100} x2={pos.x + NODE_W.frontend - 12} y2={pos.y + 100}
                stroke="#1e293b" strokeWidth={1} />

              {/* URL at bottom */}
              <text x={pos.x + NODE_W.frontend / 2} y={pos.y + 116}
                fontSize={6.5} fill="#334155" textAnchor="middle">
                {node.url.length > 34 ? node.url.slice(0, 34) + "…" : node.url}
              </text>

              {/* Status dot */}
              <circle cx={pos.x + NODE_W.frontend - 14} cy={pos.y + 16} r={4}
                fill={sc.border} opacity={0.8} />
            </g>
          );
        })}

        {/* ── API OUTER BOX ───────────────────────────────────────────────── */}
        <rect x={API_X} y={LAYER.api.y} width={API_W} height={LAYER.api.h}
          rx={14} fill={C.api.bg} stroke={C.api.border} strokeWidth={1.5} />
        {/* top accent bar */}
        <rect x={API_X} y={LAYER.api.y} width={API_W} height={4} rx={2} fill={C.api.border} />

        {/* API title + hosting/runtime badges */}
        <text x={API_X + 18} y={LAYER.api.y + 24}
          fontSize={11} fontWeight={700} fill={C.api.title}>{apiTitle}</text>
        {hosting && (
          <text x={API_X + 18} y={LAYER.api.y + 38}
            fontSize={8} fill="#6366f1">{HOSTING_ICON[hosting] ?? "🏠"} {hosting}</text>
        )}
        {runtime && (
          <text x={API_X + (hosting ? 120 : 18)} y={LAYER.api.y + 38}
            fontSize={8} fill="#475569">{runtime}</text>
        )}
        {/* Endpoint count badge */}
        {totalEndpoints > 0 && (
          <text x={API_X + 18} y={LAYER.api.y + 50}
            fontSize={7.5} fill="#475569">
            <tspan fill="#6366f1" fontWeight={600}>{totalEndpoints}</tspan>
            {" endpoints"}
            {schema?.version ? <tspan fill="#334155">  ·  v{schema.version}</tspan> : null}
          </text>
        )}
        {/* system URL */}
        <text x={API_X + API_W - 18} y={LAYER.api.y + 24}
          fontSize={8} fill="#334155" textAnchor="end">
          {(() => { try { return new URL(system.url).hostname; } catch { return system.url; } })()}
        </text>

        {/* ── ROUTE GROUP sub-boxes ────────────────────────────────────── */}
        {rgCount > 0 && routeGroups.map((rg, i) => {
          const rx_ = API_X + RG_PAD + i * (RG_W + rgGap);
          const ry_ = LAYER.api.y + 58;
          const displayEps = rg.endpoints.slice(0, 4);
          return (
            <g key={rg.tag}>
              <rect x={rx_} y={ry_} width={RG_W} height={RG_H}
                rx={7} fill="#0e0e1a" stroke={rg.color} strokeWidth={1} />
              <rect x={rx_} y={ry_} width={RG_W} height={3} rx={1.5} fill={rg.color} />
              {/* tag label */}
              <text x={rx_ + RG_W / 2} y={ry_ + 16}
                fontSize={9.5} fontWeight={700} fill={rg.color} textAnchor="middle">
                /{rg.tag}/*
              </text>
              {/* endpoint paths */}
              {displayEps.map((ep, j) => (
                <text
                  key={j}
                  x={rx_ + RG_W / 2}
                  y={ry_ + 30 + j * 14}
                  fontSize={7.5} fill="#475569" textAnchor="middle"
                >
                  <tspan fill={
                    ep.method === "GET"    ? "#22c55e" :
                    ep.method === "POST"   ? "#3b82f6" :
                    ep.method === "DELETE" ? "#ef4444" :
                    ep.method === "PATCH"  ? "#f97316" :
                    "#94a3b8"
                  }>{ep.method}</tspan>
                  {" "}{ep.path.length > 18 ? ep.path.slice(0, 18) + "…" : ep.path}
                </text>
              ))}
              {rg.total > 4 && (
                <text x={rx_ + RG_W / 2} y={ry_ + RG_H - 8}
                  fontSize={7} fill="#334155" textAnchor="middle">
                  +{rg.total - 4} more
                </text>
              )}
            </g>
          );
        })}

        {/* No schema hint inside API box */}
        {rgCount === 0 && (
          <text x={API_X + API_W / 2} y={LAYER.api.y + LAYER.api.h / 2 + 14}
            fontSize={9} fill="#334155" textAnchor="middle">
            Set OPENWATCH_SERVICE_URL on probe to discover API endpoints
          </text>
        )}

        {/* ── INFRA NODES ─────────────────────────────────────────────────── */}
        {infraPositions.map((pos) => {
          const node = infraNodes.find(n => n.id === pos.id)!;
          const sc   = C.infra[node.kind] ?? C.infra.default;
          const statusDot = node.status === "up" ? "#22c55e" : node.status === "down" ? "#ef4444" : node.status === "degraded" ? "#f59e0b" : undefined;
          return (
            <g key={pos.id}>
              <rect x={pos.x} y={pos.y} width={NODE_W.infra} height={LAYER.infra.h}
                rx={10} fill={sc.bg} stroke={sc.border} strokeWidth={1.5} />
              <rect x={pos.x} y={pos.y} width={NODE_W.infra} height={4} rx={2} fill={sc.border} />
              {/* Icon + name */}
              <text x={pos.x + NODE_W.infra / 2} y={pos.y + 28}
                fontSize={12} textAnchor="middle">{node.icon}</text>
              <text x={pos.x + NODE_W.infra / 2} y={pos.y + 46}
                fontSize={10} fontWeight={700} fill={sc.title} textAnchor="middle">{node.name}</text>
              <text x={pos.x + NODE_W.infra / 2} y={pos.y + 60}
                fontSize={8} fill="#475569" textAnchor="middle">{node.sub}</text>
              {node.latency != null && (
                <text x={pos.x + NODE_W.infra / 2} y={pos.y + 74}
                  fontSize={8} fill="#475569" textAnchor="middle">{node.latency.toFixed(0)} ms</text>
              )}
              {statusDot && (
                <circle cx={pos.x + NODE_W.infra - 14} cy={pos.y + 16} r={4} fill={statusDot} opacity={0.9} />
              )}
            </g>
          );
        })}

        {/* ── Bottom metadata bar ──────────────────────────────────────────── */}
        <text x={W / 2} y={H - 12} fontSize={8} fill="#1e293b" textAnchor="middle" letterSpacing={2.5}>
          OPENWATCH AUTO-DISCOVERY  ·  {system.name.toUpperCase()}  ·  {new Date().toLocaleDateString()}
        </text>

        {/* ── "Collecting…" hint — only shown in the FRONTENDS row when empty ── */}
        {frontends.length === 0 && (
          <text x={W / 2} y={LAYER.frontends.y + 50}
            fontSize={9} fill="#1e293b" textAnchor="middle" letterSpacing={1}>
            FRONTEND URLS COLLECTING… (auto-discovered from CORS headers each 5 min)
          </text>
        )}
        {routeGroups.length === 0 && (
          <text x={API_X + API_W / 2} y={LAYER.api.y + LAYER.api.h / 2}
            fontSize={9} fill="#1e293b" textAnchor="middle" letterSpacing={1}>
            API ENDPOINTS COLLECTING… (OpenAPI discovery runs each 5 min)
          </text>
        )}
      </svg>

      {/* ── Legend ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-x-6 gap-y-1.5 px-5 py-3 border-t border-gray-800 text-[11px] font-mono text-gray-600">
        {[
          { color: "#3b82f6",  label: "Clients / DB" },
          { color: "#6366f1",  label: "API service" },
          { color: "#22c55e",  label: "Up / Payments" },
          { color: "#a855f7",  label: "Email / Merchant" },
          { color: "#ef4444",  label: "Down / Cache" },
          { color: "#f59e0b",  label: "Degraded" },
          { color: "#06b6d4",  label: "AI / Realtime" },
          { color: "#334155",  label: "Admin / VCS" },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 rounded-full" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
