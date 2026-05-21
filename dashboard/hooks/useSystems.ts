// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState, useEffect, useCallback } from "react";
import {
  fetchSystems,
  addSystem as apiAdd,
  removeSystem as apiRemove,
  type MonitoredSystem,
} from "@/lib/api";

export function useSystems() {
  const [systems, setSystems] = useState<MonitoredSystem[]>([]);
  const [total, setTotal] = useState(0);
  const [max, setMax] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchSystems();
      setSystems(data.systems);
      setTotal(data.total);
      setMax(data.max);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach backend");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const add = useCallback(
    async (name: string, url: string) => {
      await apiAdd(name, url);
      await load();
    },
    [load]
  );

  const remove = useCallback(
    async (id: string) => {
      await apiRemove(id);
      await load();
    },
    [load]
  );

  return { systems, total, max, loading, error, add, remove, refresh: load };
}
