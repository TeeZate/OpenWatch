// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState, useEffect, useCallback } from "react";
import { fetchProbeExtended, type ProbeExtendedData } from "@/lib/api";

// Extended data is collected every ~5 minutes by the probe, so polling every
// 5 minutes here is sufficient. We also do a single eager fetch on mount so
// previously-cached data appears immediately.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function useProbeExtended(systemId: string) {
  const [data,    setData]    = useState<ProbeExtendedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchProbeExtended(systemId);
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not fetch extended data");
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  return { data, loading, error, refresh: load };
}
