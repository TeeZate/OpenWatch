"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

import dynamic from "next/dynamic";
import { useState } from "react";
import { ServiceList } from "@/components/health/ServiceList";
import { ServiceDetailPanel } from "@/components/detail/ServiceDetailPanel";
import { RiskPanel } from "@/components/risks/RiskPanel";
import { ConnectedSystems } from "@/components/systems/ConnectedSystems";
import { useLiveHealth } from "@/hooks/useLiveHealth";
import { useTopology } from "@/hooks/useTopology";
import { useRisks } from "@/hooks/useRisks";
import type { CytoscapeNodeData, ServiceLiveState } from "@/lib/api";

const TopologyMap = dynamic(
  () => import("@/components/topology/TopologyMap").then((m) => m.TopologyMap),
  { ssr: false, loading: () => <Placeholder text="Loading topology…" /> }
);

type Tab = "systems" | "monitor" | "risks";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>("systems");
  const { data: topology, loading: topoLoading, error: topoError } = useTopology();
  const { services, summary, healthMap, connected } = useLiveHealth();
  const { criticalCount } = useRisks();
  const [selectedNode, setSelectedNode] = useState<CytoscapeNodeData | null>(null);

  const selectedService = services.find((s) => s.id === selectedNode?.id) ?? null;

  function handleNodeSelect(node: CytoscapeNodeData | null) { setSelectedNode(node); }
  function handleServiceSelect(svc: ServiceLiveState) {
    setSelectedNode({
      id:         svc.id,
      label:      svc.name,
      type:       "service",
      kind:       svc.kind,
      status:     svc.health_status,
      latency_ms: svc.latency_ms ?? undefined,
      port:       svc.port,
      hostname:   svc.hostname,
    });
  }


  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">

      {/* ── Top nav bar ─────────────────────────────────────────────────── */}
      <header className="flex items-center gap-0 px-4 bg-gray-900 border-b border-gray-800 flex-shrink-0">

        {/* Logo */}
        <div className="flex items-center gap-2 pr-6 py-3 border-r border-gray-800">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <span className="font-bold text-white text-sm tracking-wide">OpenWatch</span>
        </div>

        {/* Tabs */}
        <nav className="flex items-stretch gap-0 flex-1 px-2">
          <TabButton active={activeTab === "systems"} onClick={() => setActiveTab("systems")}>
            Systems
          </TabButton>
          <TabButton active={activeTab === "monitor"} onClick={() => setActiveTab("monitor")}>
            Monitor
          </TabButton>
          <TabButton active={activeTab === "risks"} onClick={() => setActiveTab("risks")}>
            Risks
            {criticalCount > 0 && (
              <span className="ml-1.5 bg-red-600 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                {criticalCount}
              </span>
            )}
          </TabButton>
        </nav>

        {/* Live indicator + summary */}
        <div className="flex items-center gap-4 pl-4 border-l border-gray-800 py-3">
          <div className="flex items-center gap-3 text-xs">
            <Pill color="green"  count={summary.up}       label="Up" />
            <Pill color="yellow" count={summary.degraded} label="Degraded" />
            <Pill color="red"    count={summary.down}     label="Down" />
          </div>
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500" : "bg-gray-600 animate-pulse"}`} />
            {connected ? "live" : "reconnecting…"}
          </span>
        </div>
      </header>

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden min-h-0">

        {/* Systems tab */}
        {activeTab === "systems" && (
          <ConnectedSystems />
        )}

        {/* Monitor tab — existing 3-pane layout */}
        {activeTab === "monitor" && (
          <div className="flex h-full overflow-hidden">
            <aside className="w-56 border-r border-gray-800 flex flex-col bg-gray-900 overflow-hidden">
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-widest border-b border-gray-800">
                Services
              </div>
              <div className="flex-1 overflow-y-auto">
                <ServiceList
                  services={services}
                  selectedId={selectedNode?.id}
                  onSelect={handleServiceSelect}
                />
              </div>
            </aside>

            <main className="flex-1 p-4 overflow-hidden">
              {topoError ? (
                <Placeholder text={`Cannot reach backend: ${topoError}`} isError />
              ) : topoLoading ? (
                <Placeholder text="Discovering services…" />
              ) : topology && topology.nodes.length === 0 ? (
                <Placeholder text="No services discovered yet — add a system in the Systems tab." />
              ) : topology ? (
                <TopologyMap topology={topology} healthMap={healthMap} onNodeSelect={handleNodeSelect} />
              ) : null}
            </main>

            {selectedNode && (
              <ServiceDetailPanel
                node={selectedNode}
                service={selectedService}
                onClose={() => setSelectedNode(null)}
              />
            )}
          </div>
        )}

        {/* Risks tab */}
        {activeTab === "risks" && (
          <div className="flex-1 h-full overflow-y-auto p-6">
            <RiskPanel forceExpanded />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors
        ${active
          ? "border-blue-500 text-white"
          : "border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600"
        }`}
    >
      {children}
    </button>
  );
}

function Pill({ color, count, label }: { color: "green" | "yellow" | "red"; count: number; label: string }) {
  const dot = { green: "bg-green-500", yellow: "bg-yellow-400", red: "bg-red-500" }[color];
  const txt = { green: "text-green-400", yellow: "text-yellow-300", red: "text-red-400" }[color];
  return (
    <span className="flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className={`${txt} font-medium`}>{count}</span>
      <span className="text-gray-600">{label}</span>
    </span>
  );
}

function Placeholder({ text, isError }: { text: string; isError?: boolean }) {
  return (
    <div className="flex items-center justify-center h-full rounded-lg border border-gray-800">
      <p className={`text-sm ${isError ? "text-red-400" : "text-gray-500"}`}>{text}</p>
    </div>
  );
}
