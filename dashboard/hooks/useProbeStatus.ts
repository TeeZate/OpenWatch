// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchProbeStatus, WS_URL, type ProbeStatusResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 30_000; // match probe push interval

export function useProbeStatus(systemId: string) {
  const [status, setStatus]   = useState<ProbeStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const wsRef                 = useRef<WebSocket | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchProbeStatus(systemId);
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not fetch probe status");
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  // Poll for status updates
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Also subscribe to WebSocket for instant probe disconnect/reconnect events.
  // The probe_watcher background task broadcasts health_update events with
  // probe_connected=false when a probe goes silent. This avoids waiting up
  // to 30s for the next poll to reflect the disconnect.
  useEffect(() => {
    let unmounted = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (unmounted) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (
            (msg.type === "health_update") &&
            msg.system_id === systemId &&
            typeof msg.probe_connected === "boolean"
          ) {
            if (!msg.probe_connected) {
              // Probe went silent — immediately reflect disconnect without a full refetch
              setStatus((prev) =>
                prev ? { ...prev, connected: false } : prev
              );
            } else {
              // Probe reconnected — trigger a full refetch for fresh metrics
              load();
            }
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (!unmounted) {
          retryTimeout = setTimeout(connect, 5_000);
        }
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      unmounted = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      wsRef.current?.close();
    };
  }, [systemId, load]);

  return { status, loading, error, refresh: load };
}
