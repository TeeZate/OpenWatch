"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState } from "react";
import type { APISchemaInfo, APIEndpoint } from "@/lib/api";

// ── Method badge ──────────────────────────────────────────────────────────────

const METHOD_STYLE: Record<string, string> = {
  GET:     "bg-green-900/60 text-green-300 border-green-800",
  POST:    "bg-blue-900/60 text-blue-300 border-blue-800",
  PUT:     "bg-yellow-900/60 text-yellow-300 border-yellow-800",
  PATCH:   "bg-orange-900/60 text-orange-300 border-orange-800",
  DELETE:  "bg-red-900/60 text-red-300 border-red-800",
  OPTIONS: "bg-gray-800 text-gray-400 border-gray-700",
  HEAD:    "bg-gray-800 text-gray-400 border-gray-700",
};

function MethodBadge({ method }: { method: string }) {
  const cls = METHOD_STYLE[method] ?? "bg-gray-800 text-gray-400 border-gray-700";
  return (
    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border font-mono w-14 text-center ${cls}`}>
      {method}
    </span>
  );
}

// ── Endpoint row ──────────────────────────────────────────────────────────────

function EndpointRow({ ep }: { ep: APIEndpoint }) {
  const [open, setOpen] = useState(false);
  const hasDetail = ep.summary || ep.description || (ep.tags && ep.tags.length > 0);

  return (
    <div
      className={`border-b border-gray-800/50 last:border-0 ${ep.deprecated ? "opacity-50" : ""}`}
    >
      <button
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={`w-full flex items-center gap-3 px-3 py-2 text-left ${hasDetail ? "hover:bg-gray-800/30" : ""} transition-colors`}
      >
        <MethodBadge method={ep.method} />
        <span className="font-mono text-xs text-gray-200 flex-1 truncate">{ep.path}</span>
        {ep.deprecated && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700 uppercase tracking-wider">
            deprecated
          </span>
        )}
        {ep.tags && ep.tags.length > 0 && (
          <span className="text-[10px] text-gray-600 truncate max-w-[100px]">
            {ep.tags[0]}
          </span>
        )}
        {hasDetail && (
          <span className={`text-[10px] text-gray-600 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1.5 bg-gray-900/20">
          {ep.summary && (
            <p className="text-xs text-gray-300">{ep.summary}</p>
          )}
          {ep.description && ep.description !== ep.summary && (
            <p className="text-xs text-gray-500">{ep.description}</p>
          )}
          {ep.tags && ep.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ep.tags.map((tag) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  schema: APISchemaInfo;
}

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function APISchemaPanel({ schema }: Props) {
  const [search,    setSearch]    = useState("");
  const [methodFilter, setMethodFilter] = useState<string>("ALL");

  if (schema.error && (!schema.endpoints || schema.endpoints.length === 0)) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-4 space-y-2">
        <p className="text-sm text-gray-400 font-semibold">OpenAPI schema not found</p>
        <p className="text-xs text-gray-600">{schema.error}</p>
        <div className="bg-gray-950 border border-gray-700 rounded px-3 py-2 font-mono text-[11px] text-gray-400 space-y-0.5">
          <div>Add <span className="text-yellow-400">OPENWATCH_SERVICE_URL</span>=https://your-api.railway.app</div>
          <div className="text-gray-600">to the probe service Railway variables, then redeploy.</div>
        </div>
      </div>
    );
  }

  const filtered = (schema.endpoints ?? []).filter((ep) => {
    const matchSearch = ep.path.toLowerCase().includes(search.toLowerCase()) ||
      (ep.summary ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (ep.tags ?? []).some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchMethod = methodFilter === "ALL" || ep.method === methodFilter;
    return matchSearch && matchMethod;
  });

  const methodCounts = ALL_METHODS.reduce<Record<string, number>>((acc, m) => {
    acc[m] = (schema.endpoints ?? []).filter((e) => e.method === m).length;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {schema.title && (
          <span className="font-semibold text-gray-300">{schema.title}</span>
        )}
        {schema.version && (
          <span className="text-gray-500 font-mono">v{schema.version}</span>
        )}
        <span className="text-gray-500">{(schema.endpoints ?? []).length} endpoints</span>
        {schema.source && (
          <span className="text-gray-700 truncate max-w-xs" title={schema.source}>
            via {new URL(schema.source).pathname}
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Filter by path, tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
        />
        <div className="flex gap-1">
          <button
            onClick={() => setMethodFilter("ALL")}
            className={`text-[11px] px-2.5 py-1 rounded border font-mono font-bold transition-colors ${
              methodFilter === "ALL" ? "bg-gray-700 border-gray-600 text-white" : "border-gray-800 text-gray-500 hover:border-gray-700"
            }`}
          >
            ALL
          </button>
          {ALL_METHODS.filter((m) => methodCounts[m] > 0).map((m) => {
            const cls = METHOD_STYLE[m] ?? "";
            return (
              <button
                key={m}
                onClick={() => setMethodFilter(m === methodFilter ? "ALL" : m)}
                className={`text-[11px] px-2 py-1 rounded border font-mono font-bold transition-colors ${
                  methodFilter === m ? cls : "border-gray-800 text-gray-500 hover:border-gray-700"
                }`}
              >
                {m} <span className="text-[9px] opacity-70">{methodCounts[m]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Endpoint list */}
      <div className="rounded-lg border border-gray-800 overflow-hidden">
        {filtered.length > 0
          ? filtered.map((ep, i) => <EndpointRow key={`${ep.method}-${ep.path}-${i}`} ep={ep} />)
          : (
            <p className="text-sm text-gray-600 text-center py-6">No endpoints match your filter</p>
          )
        }
      </div>

      {schema.collected_at && (
        <p className="text-[11px] text-gray-700 text-right">
          collected {new Date(schema.collected_at).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
