"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState } from "react";
import { useProbeStatus }   from "@/hooks/useProbeStatus";
import { useProbeTokens }   from "@/hooks/useProbeTokens";
import { ConnectProbeModal }    from "./ConnectProbeModal";
import { ProbeMetricsChart }    from "./ProbeMetricsChart";
import type { MonitoredSystem, ProbeToken } from "@/lib/api";

interface Props {
  system: MonitoredSystem;
}

// ── Gauge bar ─────────────────────────────────────────────────────────────────

function GaugeBar({ pct, color = "bg-blue-500" }: { pct: number; color?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1 w-full bg-gray-800 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, pct, color,
}: {
  label:  string;
  value:  string;
  sub?:   string;
  pct?:   number;
  color?: string;
}) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2.5 space-y-1.5">
      <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">{label}</p>
      <p className="text-base font-bold text-white font-mono leading-none">{value}</p>
      {sub  && <p className="text-[10px] text-gray-500">{sub}</p>}
      {pct != null && <GaugeBar pct={pct} color={color} />}
    </div>
  );
}

// ── Relative time ─────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s <  60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ── Token row ─────────────────────────────────────────────────────────────────

function TokenRow({
  token,
  onRevoke,
  revoking,
}: {
  token:    ProbeToken;
  onRevoke: (id: string) => void;
  revoking: string | null;
}) {
  const isRevoking = revoking === token.token_id;

  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          token.revoked   ? "bg-gray-600" :
          token.activated ? "bg-green-500" :
                            "bg-yellow-500"
        }`} />
        <div className="min-w-0">
          <p className="text-xs font-mono text-gray-300 truncate">{token.token_id.slice(0, 18)}…</p>
          <p className="text-[10px] text-gray-600">
            {token.revoked
              ? "Revoked"
              : token.activated
              ? `Active · bound to host`
              : "Pending · not yet registered"}
          </p>
        </div>
      </div>
      {!token.revoked && (
        <button
          onClick={() => onRevoke(token.token_id)}
          disabled={isRevoking}
          className="flex-shrink-0 text-[10px] px-2 py-1 rounded border border-red-900/60 text-red-500 hover:bg-red-950/40 hover:text-red-400 disabled:opacity-40 transition-colors font-medium"
        >
          {isRevoking ? "Revoking…" : "Revoke"}
        </button>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ProbePanel({ system }: Props) {
  const [showModal, setShowModal] = useState(false);

  const { status, loading: statusLoading } = useProbeStatus(system.id);
  const { activeTokens, loading: tokensLoading, issue, revoke, revoking } =
    useProbeTokens(system.id);

  const connected  = status?.connected ?? false;
  const os         = status?.os   ?? {};
  const net        = status?.network ?? {};

  const cpuColor  = (os.cpu_pct  ?? 0) > 80 ? "bg-red-500" : (os.cpu_pct ?? 0) > 60 ? "bg-yellow-500" : "bg-blue-500";
  const memColor  = (os.mem_used_pct ?? 0) > 80 ? "bg-red-500" : (os.mem_used_pct ?? 0) > 60 ? "bg-yellow-500" : "bg-purple-500";
  const diskColor = (os.disk_used_pct ?? 0) > 80 ? "bg-red-500" : (os.disk_used_pct ?? 0) > 60 ? "bg-yellow-500" : "bg-teal-500";

  const formatBytes = (bps: number) => {
    if (bps > 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`;
    if (bps > 1_000)     return `${(bps / 1_000).toFixed(0)} KB/s`;
    return `${bps.toFixed(0)} B/s`;
  };

  if (statusLoading || tokensLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-gray-600 text-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-700 animate-pulse" />
        Loading probe status…
      </div>
    );
  }

  return (
    <>
      {/* ── Connected state ────────────────────────────────────────────────── */}
      {connected && status ? (
        <div className="space-y-4">
          {/* Liveness banner */}
          <div className="flex items-center justify-between border border-green-800/50 bg-green-950/20 rounded-lg px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-semibold text-green-400">Probe Connected</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-gray-500">
              <span>seq <span className="text-gray-400 font-mono">{status.sequence}</span></span>
              <span>last push <span className="text-gray-400">{relativeTime(status.last_seen)}</span></span>
            </div>
          </div>

          {/* OS metrics grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MetricCard
              label="CPU"
              value={`${(os.cpu_pct ?? 0).toFixed(1)}%`}
              pct={os.cpu_pct}
              color={cpuColor}
            />
            <MetricCard
              label="Memory"
              value={`${(os.mem_used_pct ?? 0).toFixed(1)}%`}
              sub={`${os.mem_used_mb ?? 0} / ${os.mem_total_mb ?? 0} MB`}
              pct={os.mem_used_pct}
              color={memColor}
            />
            <MetricCard
              label="Disk"
              value={`${(os.disk_used_pct ?? 0).toFixed(1)}%`}
              sub={`${(os.disk_used_gb ?? 0).toFixed(1)} / ${(os.disk_total_gb ?? 0).toFixed(1)} GB`}
              pct={os.disk_used_pct}
              color={diskColor}
            />
            <MetricCard
              label="Load (1m)"
              value={`${(os.load_1m ?? 0).toFixed(2)}`}
              sub={`${(net.connections ?? 0)} connections`}
            />
          </div>

          {/* Network row */}
          {(net.bytes_in_ps != null || net.bytes_out_ps != null) && (
            <div className="grid grid-cols-3 gap-2">
              <MetricCard
                label="Inbound"
                value={formatBytes(net.bytes_in_ps ?? 0)}
              />
              <MetricCard
                label="Outbound"
                value={formatBytes(net.bytes_out_ps ?? 0)}
              />
              <MetricCard
                label="Open Ports"
                value={String(net.open_ports?.length ?? 0)}
                sub={(net.open_ports ?? []).slice(0, 6).join(", ")}
              />
            </div>
          )}

          {/* Historical metrics charts */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">
              History
            </p>
            <ProbeMetricsChart systemId={system.id} />
          </div>

          {/* Process list */}
          {status.processes.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                Top Processes
              </p>
              <div className="rounded-lg border border-gray-800 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900/60">
                      <th className="text-left px-3 py-1.5 text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Process</th>
                      <th className="text-right px-3 py-1.5 text-[10px] text-gray-500 font-semibold uppercase tracking-wider">CPU</th>
                      <th className="text-right px-3 py-1.5 text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Mem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.processes.slice(0, 8).map((p) => (
                      <tr key={p.pid} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30">
                        <td className="px-3 py-1.5 font-mono text-gray-300 truncate max-w-[140px]">{p.name}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-400">{p.cpu_pct.toFixed(1)}%</td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-400">{p.mem_mb.toFixed(0)} MB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── Not connected state ──────────────────────────────────────────── */
        <div className="border border-gray-800 bg-gray-900/30 rounded-xl p-5 flex flex-col items-center gap-4 text-center">
          <div className="w-10 h-10 rounded-xl bg-gray-800/80 border border-gray-700 flex items-center justify-center">
            <svg className="w-5 h-5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414-1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-300 mb-1">No probe connected</p>
            <p className="text-xs text-gray-500 max-w-xs">
              Install the OpenWatch probe inside your infrastructure to get OS metrics,
              service health, process list, and network stats.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
          >
            Connect Probe
          </button>
        </div>
      )}

      {/* ── Token management ─────────────────────────────────────────────────── */}
      {activeTokens.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
              Active Tokens
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="text-[10px] text-blue-500 hover:text-blue-400 font-semibold transition-colors"
            >
              + Issue New
            </button>
          </div>
          <div className="bg-gray-900/40 border border-gray-800 rounded-lg px-3 divide-y divide-gray-800/50">
            {activeTokens.map((token) => (
              <TokenRow
                key={token.token_id}
                token={token}
                onRevoke={revoke}
                revoking={revoking}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Connect modal ─────────────────────────────────────────────────────── */}
      {showModal && (
        <ConnectProbeModal
          systemName={system.name}
          onIssue={issue}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
