"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

import type { ServiceLiveState } from "@/lib/api";

interface Props {
  services: ServiceLiveState[];
  selectedId?: string | null;
  onSelect?: (service: ServiceLiveState) => void;
}

const STATUS_DOT: Record<string, string> = {
  up:       "bg-green-500",
  degraded: "bg-yellow-400 animate-pulse",
  down:     "bg-red-500 animate-pulse",
  unknown:  "bg-gray-500",
};

const KIND_BADGE: Record<string, string> = {
  redis:         "text-red-400",
  postgres:      "text-blue-400",
  mysql:         "text-orange-400",
  mongodb:       "text-green-400",
  http:          "text-cyan-400",
  kafka:         "text-purple-400",
  rabbitmq:      "text-yellow-400",
  elasticsearch: "text-sky-400",
  tcp:           "text-gray-400",
};

export function ServiceList({ services, selectedId, onSelect }: Props) {
  if (services.length === 0) {
    return (
      <div className="p-4 text-gray-600 text-sm text-center">
        Waiting for agent data…
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-800">
      {services.map((svc) => {
        const isSelected = svc.id === selectedId;
        const status     = svc.health_status ?? "unknown";
        return (
          <li
            key={svc.id}
            onClick={() => onSelect?.(svc)}
            className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-800 transition-colors ${
              isSelected ? "bg-gray-800 border-l-2 border-blue-500" : ""
            }`}
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[status] ?? STATUS_DOT.unknown}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-100 truncate font-mono">
                  {svc.name}
                </span>
                <span className={`text-xs ${KIND_BADGE[svc.kind] ?? "text-gray-400"}`}>
                  :{svc.port}
                </span>
              </div>
              <div className="text-xs text-gray-500 truncate">{svc.hostname}</div>
            </div>
            {svc.latency_ms != null && (
              <span className="text-xs text-gray-500 flex-shrink-0 font-mono">
                {svc.latency_ms.toFixed(1)}ms
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
