"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

import { useCallback, useEffect, useState } from "react";
import { fetchRisks, type RisksResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 60_000;

export function useRisks() {
  const [data,    setData]    = useState<RisksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchRisks();
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load risks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  const criticalCount = data?.risks.filter((r) => r.severity === "critical").length ?? 0;

  return { data, loading, error, criticalCount, refresh: load };
}
