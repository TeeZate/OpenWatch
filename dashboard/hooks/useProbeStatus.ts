// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState, useEffect, useCallback } from "react";
import { fetchProbeStatus, type ProbeStatusResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 30_000; // match probe push interval

export function useProbeStatus(systemId: string) {
  const [status, setStatus]   = useState<ProbeStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

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

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  return { status, loading, error, refresh: load };
}
