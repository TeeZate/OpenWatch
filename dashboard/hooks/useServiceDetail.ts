"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

import { useCallback, useEffect, useState } from "react";
import { fetchHistory, fetchRisks, type RiskItem } from "@/lib/api";

export interface HistoryPoint {
  time: string;
  health_status?: string;
  latency_ms?: number;
  message?: string;
}

export interface ServiceDetail {
  serviceId: string;
  history: HistoryPoint[];
  uptime: number | null;    // percentage over window
  risks: RiskItem[];        // risks that mention this service
}

export function useServiceDetail(serviceId: string | null) {
  const [detail,  setDetail]  = useState<ServiceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [historyRes, risksRes] = await Promise.all([
        fetchHistory(id, "1 hour"),
        fetchRisks(),
      ]);

      const history: HistoryPoint[] = (historyRes as { points: HistoryPoint[] }).points ?? [];

      // Derive uptime from history points
      const total = history.length;
      const up    = history.filter((p) => p.health_status === "up").length;
      const uptime = total > 0 ? Math.round((up / total) * 1000) / 10 : null;

      // Filter risks that mention this service
      const risks = risksRes.risks.filter((r) =>
        r.affected_services.includes(id)
      );

      setDetail({ serviceId: id, history, uptime, risks });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load detail");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (serviceId) load(serviceId);
    else setDetail(null);
  }, [serviceId, load]);

  return { detail, loading, error };
}
