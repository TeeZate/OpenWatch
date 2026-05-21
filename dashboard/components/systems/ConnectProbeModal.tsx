"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState, useCallback } from "react";
import type { IssueTokenResponse } from "@/lib/api";

interface Props {
  systemName: string;
  onIssue:    () => Promise<IssueTokenResponse>;
  onClose:    () => void;
}

// ── Clipboard helper ──────────────────────────────────────────────────────────

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity  = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }
  }, []);

  return { copied, copy };
}

// ── Env var row ───────────────────────────────────────────────────────────────

function EnvRow({
  label,
  value,
  id,
  copied,
  onCopy,
}: {
  label:   string;
  value:   string;
  id:      string;
  copied:  string | null;
  onCopy:  (id: string, value: string) => void;
}) {
  const isCopied = copied === id;
  // Truncate long values for display
  const preview = value.length > 80 ? value.slice(0, 77) + "…" : value;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest font-mono">
          {label}
        </span>
        <button
          onClick={() => onCopy(id, value)}
          className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded transition-all ${
            isCopied
              ? "bg-green-900/60 text-green-400 border border-green-700"
              : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-700"
          }`}
        >
          {isCopied ? (
            <>
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      <div className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 font-mono text-[11px] text-gray-300 break-all leading-relaxed">
        {preview}
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

type Step = "idle" | "issuing" | "ready" | "error";

export function ConnectProbeModal({ systemName, onIssue, onClose }: Props) {
  const [step, setStep]       = useState<Step>("idle");
  const [result, setResult]   = useState<IssueTokenResponse | null>(null);
  const [errMsg, setErrMsg]   = useState<string | null>(null);
  const { copied, copy }      = useCopy();

  const handleIssue = useCallback(async () => {
    setStep("issuing");
    setErrMsg(null);
    try {
      const res = await onIssue();
      setResult(res);
      setStep("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Token issuance failed");
      setStep("error");
    }
  }, [onIssue]);

  // Compact JSON for the env var
  const tokenJSON = result
    ? JSON.stringify(result.token)
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-blue-900/60 border border-blue-700/50 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-white">Connect Probe</p>
              <p className="text-[10px] text-gray-500 font-mono">{systemName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white flex items-center justify-center text-sm transition-colors"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Step: idle */}
          {step === "idle" && (
            <>
              <p className="text-sm text-gray-300 leading-relaxed">
                The OpenWatch probe runs inside your infrastructure and pushes
                signed telemetry every 30 seconds. It monitors OS metrics,
                services, processes, and network — with no inbound firewall rules
                required.
              </p>
              <div className="rounded-lg border border-gray-800 bg-gray-950/50 px-4 py-3 space-y-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">What you get</p>
                <ul className="space-y-1.5 text-sm text-gray-300">
                  {["CPU, memory, disk, load average", "Service health checks (Postgres, Redis, HTTP)", "Top processes by resource usage", "Open ports & network bandwidth"].map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                onClick={handleIssue}
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
              >
                Issue Token &amp; Get Install Instructions
              </button>
            </>
          )}

          {/* Step: issuing */}
          {step === "issuing" && (
            <div className="flex flex-col items-center py-8 gap-3">
              <svg className="w-6 h-6 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-gray-400">Generating token &amp; certificate…</p>
            </div>
          )}

          {/* Step: error */}
          {step === "error" && (
            <>
              <div className="border border-red-800 bg-red-950/30 rounded-lg px-4 py-3 text-sm text-red-400">
                {errMsg ?? "Token issuance failed"}
              </div>
              <button
                onClick={() => setStep("idle")}
                className="w-full py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold transition-colors"
              >
                Try Again
              </button>
            </>
          )}

          {/* Step: ready — show env vars */}
          {step === "ready" && result && (
            <>
              <div className="flex items-center gap-2 border border-green-800/60 bg-green-950/30 rounded-lg px-3 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="text-xs text-green-400 font-medium">
                  Token issued. Set these 3 env vars on your probe service.
                </span>
              </div>

              <div className="space-y-4">
                <EnvRow
                  label="OPENWATCH_TOKEN_JSON"
                  value={tokenJSON}
                  id="token"
                  copied={copied}
                  onCopy={copy}
                />
                <EnvRow
                  label="OPENWATCH_CLIENT_CERT_PEM"
                  value={result.cert.cert_pem}
                  id="cert"
                  copied={copied}
                  onCopy={copy}
                />
                <EnvRow
                  label="OPENWATCH_CLIENT_KEY_PEM"
                  value={result.cert.key_pem}
                  id="key"
                  copied={copied}
                  onCopy={copy}
                />
              </div>

              {/* Deployment options */}
              <div className="rounded-lg border border-gray-800 bg-gray-950/50 px-4 py-3 space-y-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Deploy on Railway</p>
                <ol className="space-y-1 text-xs text-gray-400 list-decimal list-inside">
                  <li>In your Railway project → <span className="text-gray-300 font-mono">+ New Service → GitHub Repo</span></li>
                  <li>Point it at <span className="text-gray-300 font-mono">TeeZate/OpenWatch</span>, root: <span className="text-gray-300 font-mono">/probe</span></li>
                  <li>Set the 3 env vars above in the service&apos;s <span className="text-gray-300">Variables</span> tab</li>
                  <li>Deploy — the probe registers automatically on first start</li>
                </ol>
              </div>

              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold transition-colors"
              >
                Done
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
