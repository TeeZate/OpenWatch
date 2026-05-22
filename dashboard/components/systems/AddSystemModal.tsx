"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState, useEffect, useCallback } from "react";
import { issueProbeToken, type IssueTokenResponse } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type Step     = 1 | 2;
type Platform = "railway" | "docker" | "binary";
type TokenState = "idle" | "loading" | "ready" | "error";

interface Props {
  onAdd:        (name: string, url: string) => Promise<{ id: string }>;
  onClose:      () => void;
  onViewSystem: (systemId: string) => void;
  atLimit:      boolean;
}

// ── Clipboard helper ──────────────────────────────────────────────────────────

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }, []);
  return { copied, copy };
}

// ── Copy row ──────────────────────────────────────────────────────────────────

function CopyRow({ label, value, id, copied, onCopy }: {
  label: string; value: string; id: string;
  copied: string | null; onCopy: (id: string, v: string) => void;
}) {
  const isCopied = copied === id;
  const preview  = value.length > 72 ? value.slice(0, 70) + "…" : value;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest font-mono">{label}</span>
        <button
          onClick={() => onCopy(id, value)}
          className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded transition-all ${
            isCopied
              ? "bg-green-900/60 text-green-400 border border-green-700"
              : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
          }`}
        >
          {isCopied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <div className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 font-mono text-[10px] text-gray-400 break-all leading-relaxed">
        {preview}
      </div>
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepDots({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      {([1, 2] as Step[]).map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
            s === step
              ? "bg-blue-600 text-white"
              : s < step
              ? "bg-green-700 text-green-200"
              : "bg-gray-800 text-gray-500"
          }`}>
            {s < step ? "✓" : s}
          </div>
          {s < 2 && (
            <div className={`h-px w-8 transition-all ${s < step ? "bg-green-700" : "bg-gray-800"}`} />
          )}
        </div>
      ))}
      <span className="ml-1 text-xs text-gray-500">
        {step === 1 ? "System details" : "Connect a probe"}
      </span>
    </div>
  );
}

// ── Platform instructions ─────────────────────────────────────────────────────

function PlatformInstructions({ platform, result }: {
  platform: Platform;
  result:   IssueTokenResponse;
}) {
  const tokenJSON = JSON.stringify(result.token);

  if (platform === "railway") {
    return (
      <ol className="space-y-1.5 text-xs text-gray-400 list-decimal list-inside">
        <li>In your Railway project → <span className="text-gray-200 font-mono">+ New Service → GitHub Repo</span></li>
        <li>Point at your OpenWatch repo, root directory: <span className="text-gray-200 font-mono">/probe</span></li>
        <li>In the service <span className="text-gray-200">Variables</span> tab, set the 3 env vars above</li>
        <li>Deploy — the probe registers and starts sending telemetry automatically</li>
      </ol>
    );
  }

  if (platform === "docker") {
    const cmd = [
      "docker run -d --name openwatch-probe \\",
      `  -e OPENWATCH_TOKEN_JSON='${tokenJSON}' \\`,
      `  -e OPENWATCH_CLIENT_CERT_PEM='${result.cert.cert_pem.replace(/\n/g, "\\n")}' \\`,
      `  -e OPENWATCH_CLIENT_KEY_PEM='${result.cert.key_pem.replace(/\n/g, "\\n")}' \\`,
      "  --network host \\",
      "  ghcr.io/teezate/openwatch/probe:latest",
    ].join("\n");
    return (
      <pre className="text-[10px] font-mono text-gray-400 bg-gray-950 border border-gray-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
        {cmd}
      </pre>
    );
  }

  // binary
  return (
    <div className="space-y-2 text-xs text-gray-400">
      <p>Download and run the probe binary on the host you want to monitor:</p>
      <pre className="font-mono text-[10px] bg-gray-950 border border-gray-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">{
`export OPENWATCH_TOKEN_JSON='${tokenJSON}'
export OPENWATCH_CLIENT_CERT_PEM='${result.cert.cert_pem}'
export OPENWATCH_CLIENT_KEY_PEM='${result.cert.key_pem}'

# Linux / macOS
curl -sL https://github.com/TeeZate/OpenWatch/releases/latest/download/probe-linux-amd64 -o openwatch-probe
chmod +x openwatch-probe && ./openwatch-probe`
      }</pre>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export function AddSystemModal({ onAdd, onClose, onViewSystem, atLimit }: Props) {
  // Step 1 state
  const [step,      setStep]      = useState<Step>(1);
  const [name,      setName]      = useState("");
  const [url,       setUrl]       = useState("");
  const [busy,      setBusy]      = useState(false);
  const [formErr,   setFormErr]   = useState<string | null>(null);
  const [systemId,  setSystemId]  = useState<string | null>(null);

  // Step 2 state
  const [tokenState, setTokenState] = useState<TokenState>("idle");
  const [tokenResult, setTokenResult] = useState<IssueTokenResponse | null>(null);
  const [tokenErr, setTokenErr]   = useState<string | null>(null);
  const [platform, setPlatform]   = useState<Platform>("railway");

  const { copied, copy } = useCopy();

  // Auto-issue token as soon as we land on step 2
  useEffect(() => {
    if (step !== 2 || !systemId || tokenState !== "idle") return;
    setTokenState("loading");
    issueProbeToken(systemId)
      .then((r) => { setTokenResult(r); setTokenState("ready"); })
      .catch((e) => { setTokenErr(e instanceof Error ? e.message : "Failed"); setTokenState("error"); });
  }, [step, systemId, tokenState]);

  // ── Step 1 submit ──────────────────────────────────────────────────────────
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormErr(null);
    const trimUrl = url.trim();
    if (!trimUrl.startsWith("http://") && !trimUrl.startsWith("https://")) {
      setFormErr("URL must start with https:// or http://");
      return;
    }
    setBusy(true);
    try {
      const { id } = await onAdd(name.trim(), trimUrl);
      setSystemId(id);
      setStep(2);
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "Failed to add system");
    } finally {
      setBusy(false);
    }
  }

  const tokenJSON = tokenResult ? JSON.stringify(tokenResult.token) : "";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg bg-[#111117] border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <p className="text-sm font-bold text-white">
              {step === 1 ? "Add System" : "Connect a Probe"}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {step === 1
                ? "OpenWatch will start probing this URL every 30 seconds"
                : "Optional — unlocks deep OS + service monitoring"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white
                       flex items-center justify-center text-sm transition-colors"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[80vh] overflow-y-auto space-y-5">

          <StepDots step={step} />

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <>
              {atLimit && (
                <div className="rounded-lg bg-yellow-950/60 border border-yellow-800/50 px-4 py-3 text-sm text-yellow-300">
                  You've reached the limit of 10 monitored systems. Remove one first.
                </div>
              )}

              <form onSubmit={handleAdd} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Display Name
                  </label>
                  <input
                    className="w-full rounded-lg bg-gray-900 border border-gray-700 text-white px-3 py-2.5 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder-gray-600"
                    placeholder="e.g. TrustLedger API"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required disabled={busy || atLimit}
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    System URL
                  </label>
                  <input
                    className="w-full rounded-lg bg-gray-900 border border-gray-700 text-white px-3 py-2.5 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder-gray-600"
                    placeholder="https://your-app.up.railway.app"
                    type="url" value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required disabled={busy || atLimit}
                  />
                  <p className="text-[11px] text-gray-600">
                    OpenWatch will try /health, /healthz, and / automatically.
                  </p>
                </div>

                {/* What you get without a probe */}
                <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3 space-y-2">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Without a probe</p>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px] text-gray-400">
                    {["✓ Uptime monitoring", "✓ Latency tracking", "✓ Health endpoint status", "✓ Sub-service topology"].map(i => (
                      <span key={i}>{i}</span>
                    ))}
                  </div>
                </div>

                {formErr && (
                  <div className="rounded-lg bg-red-950/60 border border-red-800/50 px-4 py-3 text-sm text-red-300">
                    {formErr}
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={onClose} disabled={busy}
                    className="flex-1 rounded-lg border border-gray-700 text-gray-400 py-2.5 text-sm
                               hover:bg-gray-800 transition-colors disabled:opacity-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={busy || atLimit}
                    className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white py-2.5 text-sm
                               font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                               flex items-center justify-center gap-2">
                    {busy ? (
                      <><Spinner /> Adding…</>
                    ) : (
                      <>Continue <span className="opacity-70">→</span></>
                    )}
                  </button>
                </div>
              </form>
            </>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && (
            <>
              {/* System added banner */}
              <div className="flex items-center gap-2 bg-green-950/40 border border-green-800/50 rounded-lg px-3 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                <span className="text-xs text-green-400 font-medium">
                  <span className="font-bold text-green-300">{name}</span> is being monitored.
                  Probing every 30 s automatically.
                </span>
              </div>

              {/* What a probe adds */}
              <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3 space-y-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">With a probe you also get</p>
                <div className="grid grid-cols-2 gap-1.5 text-[11px] text-gray-300">
                  {[
                    "CPU · memory · disk metrics",
                    "Redis & Postgres health",
                    "Top processes by resource",
                    "Open ports & bandwidth",
                    "Page discovery & auth map",
                    "OpenAPI endpoint catalogue",
                  ].map(i => (
                    <span key={i} className="flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-blue-500 flex-shrink-0" />
                      {i}
                    </span>
                  ))}
                </div>
              </div>

              {/* Token loading */}
              {tokenState === "loading" && (
                <div className="flex items-center justify-center py-6 gap-3">
                  <Spinner />
                  <span className="text-sm text-gray-400">Generating probe token…</span>
                </div>
              )}

              {/* Token error */}
              {tokenState === "error" && (
                <div className="space-y-3">
                  <div className="rounded-lg bg-red-950/40 border border-red-800/50 px-4 py-3 text-sm text-red-300">
                    {tokenErr ?? "Token generation failed"}
                  </div>
                  <button
                    onClick={() => setTokenState("idle")}
                    className="w-full py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Token ready */}
              {tokenState === "ready" && tokenResult && (
                <div className="space-y-4">
                  {/* Env vars */}
                  <div className="space-y-3">
                    <CopyRow label="OPENWATCH_TOKEN_JSON"       value={tokenJSON}                id="token" copied={copied} onCopy={copy} />
                    <CopyRow label="OPENWATCH_CLIENT_CERT_PEM"  value={tokenResult.cert.cert_pem} id="cert"  copied={copied} onCopy={copy} />
                    <CopyRow label="OPENWATCH_CLIENT_KEY_PEM"   value={tokenResult.cert.key_pem}  id="key"   copied={copied} onCopy={copy} />
                  </div>

                  {/* Platform tabs */}
                  <div>
                    <div className="flex gap-1 mb-3">
                      {(["railway", "docker", "binary"] as Platform[]).map((p) => (
                        <button
                          key={p}
                          onClick={() => setPlatform(p)}
                          className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-all ${
                            platform === p
                              ? "bg-blue-600 text-white"
                              : "bg-gray-800 text-gray-400 hover:text-white"
                          }`}
                        >
                          {p === "railway" ? "🚂 Railway" : p === "docker" ? "🐳 Docker" : "⚙ Binary"}
                        </button>
                      ))}
                    </div>
                    <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-4">
                      <PlatformInstructions platform={platform} result={tokenResult} />
                    </div>
                  </div>
                </div>
              )}

              {/* Footer buttons */}
              <div className="flex gap-3 pt-1 border-t border-gray-800">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-gray-700 text-gray-400 py-2.5 text-sm
                             hover:bg-gray-800 transition-colors"
                >
                  Skip for now
                </button>
                <button
                  onClick={() => { systemId && onViewSystem(systemId); }}
                  className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white py-2.5 text-sm
                             font-semibold transition-colors flex items-center justify-center gap-1.5"
                >
                  View System <span className="opacity-70">→</span>
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
