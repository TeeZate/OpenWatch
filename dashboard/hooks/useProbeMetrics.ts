// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState, useEffect, useCallback } from "react";
import {
  fetchProbeMetricsHistory,
  type ProbeMetricsPoint,
  type ProbeMetricsWindow,
} from "@/lib/api";

export function useProbeMetrics(systemId: string, window: ProbeMetricsWindow = "1h") {
  const [points, setPoints]   = useState<ProbeMetricsPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchProbeMetricsHistory(systemId, window);
      setPoints(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load metrics history");
    } finally {
      setLoading(false);
    }
  }, [systemId, window]);

  useEffect(() => {
    setLoading(true);
    load();
    // Refresh every 30s to pick up new probe pushes
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return { points, loading, error, refresh: load };
}
