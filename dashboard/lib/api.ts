// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export const WS_URL =
  (process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000") + "/ws/live";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CytoscapeNodeData {
  id: string;
  label: string;
  type: "host" | "service";
  kind?: string;
  status?: string;
  latency_ms?: number;
  port?: number;
  hostname?: string;
}

export interface CytoscapeEdgeData {
  id: string;
  source: string;
  target: string;
}

export interface TopologyResponse {
  nodes: { data: CytoscapeNodeData }[];
  edges: { data: CytoscapeEdgeData }[];
  generated_at: string;
}

export interface ServiceLiveState {
  id: string;
  name: string;
  kind: string;
  host: string;
  port: number;
  hostname: string;
  agent_id: string;
  health_status?: string;
  latency_ms?: number;
  message?: string;
  last_seen?: string;
}

export interface HealthSummary {
  total: number;
  up: number;
  degraded: number;
  down: number;
  unknown: number;
}

export interface LiveHealthResponse {
  services: ServiceLiveState[];
  summary: HealthSummary;
  generated_at: string;
}

export interface RiskItem {
  id: string;
  severity: "critical" | "warning" | "watch";
  title: string;
  summary: string;
  affected_services: string[];
  blast_radius?: string;
  recommendation?: string;
  metadata?: Record<string, unknown>;
}

export interface RisksResponse {
  risks: RiskItem[];
  generated_at: string;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Monitored Systems ─────────────────────────────────────────────────────────

export interface MonitoredSystem {
  id: string;
  name: string;
  url: string;
  added_at: string;
  health_status?: string;
  latency_ms?: number;
  last_checked?: string;
}

export interface SystemsListResponse {
  systems: MonitoredSystem[];
  total: number;
  max: number;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

export const fetchTopology   = ()  => get<TopologyResponse>("/api/v1/topology");
export const fetchLiveHealth = ()  => get<LiveHealthResponse>("/api/v1/health/live");
export const fetchRisks      = ()  => get<RisksResponse>("/api/v1/risks");
export const fetchHistory    = (id: string, window = "1 hour") =>
  get(`/api/v1/health/history/${encodeURIComponent(id)}?window=${encodeURIComponent(window)}`);
export interface SubService {
  name: string;
  kind: string;
  status: string;
  latency_ms?: number;
  message?: string;
}

export interface SystemDetail extends MonitoredSystem {
  message?: string;
  probe_path?: string;
  sub_services: SubService[];
  updated_at?: string;
}

export const fetchSystems      = ()         => get<SystemsListResponse>("/api/v1/systems");
export const fetchSystemDetail = (id: string) => get<SystemDetail>(`/api/v1/systems/${encodeURIComponent(id)}`);

export async function addSystem(name: string, url: string): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/api/v1/systems`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Failed to add system");
  }
  return res.json();
}

export async function removeSystem(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/systems/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

// ── Probe tokens ──────────────────────────────────────────────────────────────

export interface ProbeToken {
  token_id:         string;
  system_id:        string;
  scopes:           string[];
  issued_at:        string;
  expires_at:       string;
  revoked:          boolean;
  activated:        boolean;
  host_fingerprint: string | null;
}

export interface IssueTokenResponse {
  message:      string;
  system_name:  string;
  token: {
    token_id:            string;
    system_id:           string;
    scopes:              string[];
    issued_at:           number;
    expires_at:          number;
    hmac_key:            string;
    platform_url:        string;
    platform_public_key: string;
    signature:           string;
  };
  cert: {
    cert_pem: string;
    key_pem:  string;
  };
  install_hint: string;
}

export async function fetchProbeTokens(systemId: string): Promise<ProbeToken[]> {
  return get<ProbeToken[]>(`/api/v1/systems/${encodeURIComponent(systemId)}/tokens`);
}

export async function issueProbeToken(systemId: string): Promise<IssueTokenResponse> {
  const res = await fetch(
    `${BASE}/api/v1/systems/${encodeURIComponent(systemId)}/token`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ scopes: ["os", "services", "network", "processes"] }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Token issuance failed");
  }
  return res.json();
}

export async function revokeProbeToken(systemId: string, tokenId: string): Promise<void> {
  const res = await fetch(
    `${BASE}/api/v1/systems/${encodeURIComponent(systemId)}/token/${encodeURIComponent(tokenId)}`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Revoke failed");
  }
}

// ── Probe status + metrics ────────────────────────────────────────────────────

export interface ProbeOSMetrics {
  cpu_pct:       number;
  mem_used_mb:   number;
  mem_total_mb:  number;
  mem_used_pct:  number;
  disk_used_pct: number;
  disk_used_gb:  number;
  disk_total_gb: number;
  load_1m:       number;
  uptime_s:      number;
  os:            string;
}

export interface ProbeNetworkMetrics {
  open_ports:   number[];
  connections:  number;
  bytes_in_ps:  number;
  bytes_out_ps: number;
}

export interface ProbeProcess {
  pid:    number;
  name:   string;
  cpu_pct: number;
  mem_mb:  number;
  status: string;
}

export interface ProbeStatusResponse {
  connected:  boolean;
  last_seen:  string | null;
  sequence:   number | null;
  os:         Partial<ProbeOSMetrics>;
  network:    Partial<ProbeNetworkMetrics>;
  processes:  ProbeProcess[];
  topology:   Record<string, unknown>;
}

export const fetchProbeStatus = (systemId: string) =>
  get<ProbeStatusResponse>(`/api/v1/systems/${encodeURIComponent(systemId)}/probe/status`);

// ── Probe metrics history ─────────────────────────────────────────────────────

export type ProbeMetricsWindow = "30m" | "1h" | "3h" | "6h" | "12h" | "24h";

export interface ProbeMetricsPoint {
  time:          string;
  cpu_pct:       number | null;
  mem_used_pct:  number | null;
  mem_used_mb:   number | null;
  disk_used_pct: number | null;
  load_1m:       number | null;
  bytes_in_ps:   number | null;
  bytes_out_ps:  number | null;
  connections:   number | null;
}

export const fetchProbeMetricsHistory = (systemId: string, window: ProbeMetricsWindow = "1h") =>
  get<ProbeMetricsPoint[]>(
    `/api/v1/systems/${encodeURIComponent(systemId)}/probe/metrics/history?window=${window}`
  );
