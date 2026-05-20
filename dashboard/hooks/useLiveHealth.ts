"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

import { useCallback, useEffect, useRef, useState } from "react";
import { WS_URL, type HealthSummary, type ServiceLiveState } from "@/lib/api";

export interface LatencyPoint {
  t: number;        // unix ms
  latency: number;
}

const MAX_HISTORY   = 30;   // points kept per service
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS  = 30_000;

export function useLiveHealth() {
  const [services,      setServices]      = useState<ServiceLiveState[]>([]);
  const [summary,       setSummary]       = useState<HealthSummary>({ total: 0, up: 0, degraded: 0, down: 0, unknown: 0 });
  const [healthMap,     setHealthMap]     = useState<Record<string, string>>({});
  const [latencyHistory, setLatencyHistory] = useState<Record<string, LatencyPoint[]>>({});
  const [connected,     setConnected]     = useState(false);

  const wsRef        = useRef<WebSocket | null>(null);
  const retryDelay   = useRef(BASE_DELAY_MS);
  const retryTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted    = useRef(false);

  const applyMessage = useCallback((msg: {
    type: string;
    services: ServiceLiveState[];
    summary: HealthSummary;
  }) => {
    setServices(msg.services);
    setSummary(msg.summary);

    // Build healthMap for Cytoscape node patching
    const hm: Record<string, string> = {};
    msg.services.forEach((s) => {
      if (s.health_status) hm[s.id] = s.health_status;
    });
    setHealthMap(hm);

    // Append latency readings
    const now = Date.now();
    setLatencyHistory((prev) => {
      const next = { ...prev };
      msg.services.forEach((s) => {
        if (s.latency_ms == null) return;
        const history = next[s.id] ?? [];
        next[s.id] = [
          ...history.slice(-(MAX_HISTORY - 1)),
          { t: now, latency: s.latency_ms },
        ];
      });
      return next;
    });
  }, []);

  const connect = useCallback(() => {
    if (unmounted.current) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retryDelay.current = BASE_DELAY_MS;
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === "snapshot" || msg.type === "health_update") {
          applyMessage(msg);
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (!unmounted.current) {
        retryTimer.current = setTimeout(() => {
          retryDelay.current = Math.min(retryDelay.current * 2, MAX_DELAY_MS);
          connect();
        }, retryDelay.current);
      }
    };

    ws.onerror = () => ws.close();
  }, [applyMessage]);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { services, summary, healthMap, latencyHistory, connected };
}
