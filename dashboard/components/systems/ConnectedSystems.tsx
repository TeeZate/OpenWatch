"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState } from "react";
import { useSystems } from "@/hooks/useSystems";
import { SystemCard } from "./SystemCard";
import { AddSystemModal } from "./AddSystemModal";
import { SystemDetailView } from "./SystemDetailView";
import type { MonitoredSystem } from "@/lib/api";

export function ConnectedSystems() {
  const { systems, total, max, loading, error, add, remove } = useSystems();
  const [showModal,       setShowModal]       = useState(false);
  const [selectedSystem,  setSelectedSystem]  = useState<MonitoredSystem | null>(null);
  const atLimit = total >= max;

  function handleViewSystem(systemId: string) {
    const found = systems.find(s => s.id === systemId);
    if (found) setSelectedSystem(found);
    setShowModal(false);
  }

  // ── Detail view ────────────────────────────────────────────────────────────
  if (selectedSystem) {
    return (
      <SystemDetailView
        system={selectedSystem}
        onBack={() => setSelectedSystem(null)}
      />
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-gray-500 text-sm animate-pulse">Connecting to backend…</span>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <span className="text-red-400 text-sm">{error}</span>
        <p className="text-gray-500 text-xs">Check that the backend is running and reachable.</p>
      </div>
    );
  }

  // ── Empty / Onboarding ─────────────────────────────────────────────────────
  if (systems.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center justify-center h-full gap-6 px-4">
          <div className="w-20 h-20 rounded-full bg-blue-950/60 border border-blue-800/40 flex items-center justify-center">
            <svg className="w-10 h-10 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>

          <div className="text-center max-w-sm">
            <h2 className="text-xl font-semibold text-white mb-2">Start monitoring your systems</h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              Add your hosted application URL and OpenWatch will automatically probe its health
              endpoints every 30 seconds, tracking uptime, latency, and sub-service health.
            </p>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white
                       rounded-xl px-6 py-3 text-sm font-medium transition-colors shadow-lg shadow-blue-900/40"
          >
            <PlusIcon />
            Add Your First System
          </button>

          <div className="flex flex-col gap-2 mt-2 text-center">
            <p className="text-xs text-gray-600">Monitor up to {max} systems simultaneously</p>
            <p className="text-xs text-gray-600">Probes /health, /healthz, and / automatically</p>
            <p className="text-xs text-gray-600">No agent installation required for hosted apps</p>
          </div>
        </div>

        {showModal && (
          <AddSystemModal onAdd={add} onClose={() => setShowModal(false)} onViewSystem={handleViewSystem} atLimit={atLimit} />
        )}
      </>
    );
  }

  // ── Systems grid ───────────────────────────────────────────────────────────
  const upCount       = systems.filter((s) => s.health_status === "up").length;
  const downCount     = systems.filter((s) => s.health_status === "down").length;
  const degradedCount = systems.filter((s) => s.health_status === "degraded").length;

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-gray-200">Connected Systems</h2>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-gray-400">{upCount} up</span>
              </span>
              {degradedCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-yellow-400" />
                  <span className="text-yellow-400">{degradedCount} degraded</span>
                </span>
              )}
              {downCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-red-400">{downCount} down</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{total} / {max} systems</span>
            <button
              onClick={() => setShowModal(true)}
              disabled={atLimit}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40
                         disabled:cursor-not-allowed text-white rounded-lg px-3 py-1.5 text-xs
                         font-medium transition-colors"
            >
              <PlusIcon className="w-3 h-3" />
              Add System
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {systems.map((sys) => (
              <SystemCard
                key={sys.id}
                system={sys}
                onRemove={remove}
                onClick={setSelectedSystem}
              />
            ))}
          </div>
        </div>
      </div>

      {showModal && (
        <AddSystemModal onAdd={add} onClose={() => setShowModal(false)} onViewSystem={handleViewSystem} atLimit={atLimit} />
      )}
    </>
  );
}

function PlusIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}
