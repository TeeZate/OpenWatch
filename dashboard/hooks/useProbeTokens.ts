// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState, useEffect, useCallback } from "react";
import {
  fetchProbeTokens,
  issueProbeToken,
  revokeProbeToken,
  type ProbeToken,
  type IssueTokenResponse,
} from "@/lib/api";

export function useProbeTokens(systemId: string) {
  const [tokens, setTokens]     = useState<ProbeToken[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null); // token_id being revoked

  const load = useCallback(async () => {
    try {
      const data = await fetchProbeTokens(systemId);
      setTokens(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tokens");
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => {
    load();
  }, [load]);

  const issue = useCallback(async (): Promise<IssueTokenResponse> => {
    const result = await issueProbeToken(systemId);
    await load();
    return result;
  }, [systemId, load]);

  const revoke = useCallback(
    async (tokenId: string) => {
      setRevoking(tokenId);
      try {
        await revokeProbeToken(systemId, tokenId);
        await load();
      } finally {
        setRevoking(null);
      }
    },
    [systemId, load]
  );

  const activeTokens  = tokens.filter((t) => !t.revoked);
  const revokedTokens = tokens.filter((t) => t.revoked);

  return { tokens, activeTokens, revokedTokens, loading, error, issue, revoke, revoking, refresh: load };
}
