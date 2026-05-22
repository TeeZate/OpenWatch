// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

const BASE    = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";
const OW_KEY  = process.env.NEXT_PUBLIC_OW_KEY ?? "";

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

/** Common headers sent on every management request to the backend. */
function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (OW_KEY) h["X-OW-Key"] = OW_KEY;
  return h;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    headers: authHeaders(),
  });
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
  /** Base URL of the monitored API — used by the probe for OpenAPI discovery */
  service_url?: string;
  /** Comma-separated frontend URLs — used for synthetic checks + architecture map */
  frontend_urls?: string;
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
    headers: { "Content-Type": "application/json", ...authHeaders() },
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
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export async function patchSystemConfig(
  id: string,
  serviceUrl: string,
  frontendUrls: string,
): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/systems/${encodeURIComponent(id)}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ service_url: serviceUrl, frontend_urls: frontendUrls }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Failed to save config");
  }
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
      headers: { "Content-Type": "application/json", ...authHeaders() },
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
    { method: "DELETE", headers: authHeaders() }
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
  load_5m:       number;
  load_15m:      number;
  uptime_s:      number;
  os:            string;
}

export interface ProbeTopologyInfo {
  hostname: string;
  os:       string;   // "linux" | "darwin" | "windows"
  arch:     string;   // "amd64" | "arm64" etc.
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
  topology:   Partial<ProbeTopologyInfo>;
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

// ── Probe extended data (schema, endpoints, synthetics) ───────────────────────

export interface DBColumn {
  name:        string;
  data_type:   string;
  nullable:    boolean;
  has_default: boolean;
  is_pk?:      boolean;
}

export interface DBTable {
  name:       string;
  row_est:    number;
  size_bytes: number;
  columns:    DBColumn[];
}

export interface DatabaseInfo {
  connected:    boolean;
  version?:     string;
  db_name?:     string;
  size_bytes:   number;
  tables:       DBTable[];
  error?:       string;
  collected_at: string;
}

export interface APIEndpoint {
  method:       string;
  path:         string;
  summary?:     string;
  description?: string;
  tags?:        string[];
  deprecated?:  boolean;
}

export interface APISchemaInfo {
  title?:       string;
  version?:     string;
  endpoints:    APIEndpoint[];
  source?:      string;
  error?:       string;
  collected_at: string;
}

export interface SyntheticResult {
  name:         string;
  url:          string;
  status:       string;
  status_code?: number;
  latency_ms:   number;
  redirects?:   number;
  error?:       string;
}

export interface ArchIntegration {
  name:    string;
  kind:    string;
  env_key: string;
  icon?:   string;
}

export interface ArchitectureInfo {
  hosting?:      string;
  runtime?:      string;
  integrations:  ArchIntegration[];
  cors_origins?: string[];
  collected_at:  string;
}

export interface PageInfo {
  path:          string;
  title?:        string;
  auth_required: boolean;
  status_code:   number;
  redirects_to?: string;
}

export interface FrontendPageInfo {
  url:              string;
  framework:        string;   // "Next.js" | "React" | "Vue.js" | ""
  total_pages:      number;
  public_pages:     number;
  protected_pages:  number;
  pages:            PageInfo[];
  collected_at:     string;
  error?:           string;
}

export interface ProbeExtendedData {
  database?:     DatabaseInfo | null;
  api_schema?:   APISchemaInfo | null;
  synthetics:    SyntheticResult[];
  architecture?: ArchitectureInfo | null;
  frontends?:    FrontendPageInfo[];
  updated_at?:   string;
}

export const fetchProbeExtended = (systemId: string) =>
  get<ProbeExtendedData>(`/api/v1/systems/${encodeURIComponent(systemId)}/probe/extended`);
