"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState } from "react";

interface Props {
  onAdd: (name: string, url: string) => Promise<void>;
  onClose: () => void;
  atLimit: boolean;
}

export function AddSystemModal({ onAdd, onClose, atLimit }: Props) {
  const [name, setName] = useState("");
  const [url, setUrl]   = useState("");
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const trimUrl = url.trim();
    if (!trimUrl.startsWith("http://") && !trimUrl.startsWith("https://")) {
      setErr("URL must start with https:// or http://");
      return;
    }

    setBusy(true);
    try {
      await onAdd(name.trim(), trimUrl);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add system");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-1">Add System to Monitor</h2>
        <p className="text-sm text-gray-400 mb-5">
          OpenWatch will probe the health endpoints of your system every 30 seconds.
        </p>

        {atLimit && (
          <div className="mb-4 rounded-lg bg-yellow-950/60 border border-yellow-800/50 px-4 py-3 text-sm text-yellow-300">
            You have reached the maximum of 10 monitored systems. Remove one first.
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-300 uppercase tracking-wide">
              Display Name
            </label>
            <input
              className="rounded-lg bg-gray-800 border border-gray-700 text-white px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder-gray-500"
              placeholder="e.g. TrustLedger API"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={busy || atLimit}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-300 uppercase tracking-wide">
              System URL
            </label>
            <input
              className="rounded-lg bg-gray-800 border border-gray-700 text-white px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder-gray-500"
              placeholder="https://your-app.up.railway.app"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              disabled={busy || atLimit}
            />
            <p className="text-[11px] text-gray-500">
              OpenWatch will try /health, /healthz, and / automatically.
            </p>
          </div>

          {err && (
            <div className="rounded-lg bg-red-950/60 border border-red-800/50 px-4 py-3 text-sm text-red-300">
              {err}
            </div>
          )}

          <div className="flex gap-3 mt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-lg border border-gray-700 text-gray-300 py-2.5 text-sm
                         hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || atLimit}
              className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white py-2.5 text-sm
                         font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Adding…" : "Add System"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
