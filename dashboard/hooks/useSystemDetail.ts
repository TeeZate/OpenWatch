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
      setDetail(data);
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
