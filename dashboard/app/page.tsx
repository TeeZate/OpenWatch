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
import { StatusBar } from "@/components/ui/StatusBar";
import { useLiveHealth } from "@/hooks/useLiveHealth";
import { useTopology } from "@/hooks/useTopology";
import type { CytoscapeNodeData, ServiceLiveState } from "@/lib/api";

// Cytoscape must be loaded client-side only — no SSR.
const TopologyMap = dynamic(
  () => import("@/components/topology/TopologyMap").then((m) => m.TopologyMap),
  { ssr: false, loading: () => <MapPlaceholder text="Loading topology…" /> }
);

export default function HomePage() {
  const { data: topology, loading, error } = useTopology();
  const { services, summary, healthMap, connected } = useLiveHealth();
  const [selectedNode, setSelectedNode] = useState<CytoscapeNodeData | null>(null);

  // When a node is selected in the map, also select the matching service
  const selectedService = services.find((s) => s.id === selectedNode?.id) ?? null;

  function handleNodeSelect(node: CytoscapeNodeData | null) {
    setSelectedNode(node);
  }

  function handleServiceSelect(svc: ServiceLiveState) {
    // Mirror service list selection to the node sidebar
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
      <StatusBar summary={summary} lastUpdated={new Date().toISOString()}>
        <span className="flex items-center gap-1.5 text-xs text-gray-500 ml-2">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500" : "bg-gray-600 animate-pulse"}`} />
          {connected ? "live" : "reconnecting…"}
        </span>
      </StatusBar>

      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Services sidebar (left) ─────────────────────────────────────── */}
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

        {/* ── Topology map (centre) ───────────────────────────────────────── */}
        <main className="flex-1 p-4 overflow-hidden">
          {error ? (
            <MapPlaceholder text={`Cannot reach backend: ${error}`} isError />
          ) : loading ? (
            <MapPlaceholder text="Discovering services…" />
          ) : topology && topology.nodes.length === 0 ? (
            <MapPlaceholder text="No services discovered yet. Is the agent running?" />
          ) : topology ? (
            <TopologyMap
              topology={topology}
              healthMap={healthMap}
              onNodeSelect={handleNodeSelect}
            />
          ) : null}
        </main>

        {/* ── Node detail panel (right) ───────────────────────────────────── */}
        {selectedNode && (
          <ServiceDetailPanel
            node={selectedNode}
            service={selectedService}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>

      {/* ── Risk panel (collapsible bottom drawer) ──────────────────────── */}
      <RiskPanel />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function MapPlaceholder({ text, isError }: { text: string; isError?: boolean }) {
  return (
    <div className="flex items-center justify-center h-full rounded-lg border border-gray-800">
      <p className={`text-sm ${isError ? "text-red-400" : "text-gray-500"}`}>{text}</p>
    </div>
  );
}
