// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState, useEffect, useCallback } from "react";
import { fetchSystemDetail, type SystemDetail } from "@/lib/api";

export function useSystemDetail(systemId: string | null) {
  const [detail,  setDetail]  = useState<SystemDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!systemId) return;
    setLoading(true);
    try {
      const data = await fetchSystemDetail(systemId);
      // Only update if we actually got richer data — never downgrade from a
      // version that has sub_services to one that doesn't (stale-while-revalidate)
      setDetail(prev => {
        if (!prev) return data;
        // If the new data has sub_services, always use it
        if (data.sub_services.length > 0) return data;
        // If the previous data had sub_services but new one is empty, keep the old
        if (prev.sub_services.length > 0 && data.sub_services.length === 0) return prev;
        return data;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load system detail");
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => {
    if (!systemId) { setDetail(null); return; }
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [systemId, load]);

  return { detail, loading, error, refresh: load };
}
