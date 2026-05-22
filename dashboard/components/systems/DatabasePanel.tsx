"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import { useState } from "react";
import type { DatabaseInfo, DBTable, DBColumn } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b >= 1_024)         return `${(b / 1_024).toFixed(0)} KB`;
  return `${b} B`;
}

function fmtRows(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const TYPE_COLOR: Record<string, string> = {
  "integer":                   "text-blue-400",
  "bigint":                    "text-blue-400",
  "smallint":                  "text-blue-400",
  "numeric":                   "text-blue-400",
  "double precision":          "text-blue-400",
  "real":                      "text-blue-400",
  "boolean":                   "text-purple-400",
  "text":                      "text-green-400",
  "character varying":         "text-green-400",
  "character":                 "text-green-400",
  "uuid":                      "text-yellow-400",
  "timestamp with time zone":  "text-orange-400",
  "timestamp without time zone":"text-orange-400",
  "date":                      "text-orange-400",
  "jsonb":                     "text-pink-400",
  "json":                      "text-pink-400",
  "bytea":                     "text-gray-400",
};

function typeColor(t: string): string {
  return TYPE_COLOR[t.toLowerCase()] ?? "text-gray-400";
}

// ── Column row ────────────────────────────────────────────────────────────────

function ColumnRow({ col }: { col: DBColumn }) {
  return (
    <tr className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/20">
      <td className="px-3 py-1.5 font-mono text-xs text-gray-200 flex items-center gap-1.5">
        {col.is_pk && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-900/60 text-yellow-400 font-bold uppercase tracking-wider leading-none">PK</span>
        )}
        {col.name}
      </td>
      <td className={`px-3 py-1.5 font-mono text-xs ${typeColor(col.data_type)}`}>
        {col.data_type}
      </td>
      <td className="px-3 py-1.5 text-xs text-center">
        {col.nullable
          ? <span className="text-gray-600">null</span>
          : <span className="text-red-400/80 text-[10px] font-bold">NOT NULL</span>
        }
      </td>
      <td className="px-3 py-1.5 text-xs text-center">
        {col.has_default && <span className="text-gray-500 text-[10px]">default</span>}
      </td>
    </tr>
  );
}

// ── Table accordion row ────────────────────────────────────────────────────────

function TableRow({ table }: { table: DBTable }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-gray-900/60 hover:bg-gray-800/60 transition-colors text-left"
      >
        <span className={`text-xs transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="font-mono text-sm font-semibold text-gray-100 flex-1">{table.name}</span>
        <span className="text-[11px] text-gray-500 font-mono">{table.columns.length} cols</span>
        <span className="text-[11px] text-gray-400 font-mono w-16 text-right">{fmtRows(table.row_est)} rows</span>
        <span className="text-[11px] text-gray-500 font-mono w-14 text-right">{fmtBytes(table.size_bytes)}</span>
      </button>

      {/* Column details */}
      {open && table.columns.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/60">
                <th className="text-left px-3 py-1.5 text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Column</th>
                <th className="text-left px-3 py-1.5 text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Type</th>
                <th className="text-center px-3 py-1.5 text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Null</th>
                <th className="text-center px-3 py-1.5 text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Default</th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((col) => (
                <ColumnRow key={col.name} col={col} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && table.columns.length === 0 && (
        <p className="px-4 py-3 text-xs text-gray-600">No column data available.</p>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  db: DatabaseInfo;
}

export function DatabasePanel({ db }: Props) {
  const [search, setSearch] = useState("");

  if (!db.connected) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-400">
        {db.error ?? "Could not connect to database"}
      </div>
    );
  }

  const filtered = (db.tables ?? []).filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {db.db_name && (
          <span className="font-mono text-gray-300 font-semibold">{db.db_name}</span>
        )}
        <span className="text-gray-500">{(db.tables ?? []).length} tables</span>
        <span className="text-gray-500">{fmtBytes(db.size_bytes)} total</span>
        {db.version && (
          <span className="text-gray-600 truncate max-w-xs" title={db.version}>
            {db.version.split(" ").slice(0, 2).join(" ")}
          </span>
        )}
        {db.collected_at && (
          <span className="text-gray-700 ml-auto">
            collected {new Date(db.collected_at).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Search */}
      {(db.tables ?? []).length > 4 && (
        <input
          type="text"
          placeholder="Filter tables…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
        />
      )}

      {/* Table accordion */}
      <div className="space-y-1.5">
        {filtered.map((t) => (
          <TableRow key={t.name} table={t} />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-gray-600 text-center py-4">No tables match "{search}"</p>
        )}
      </div>
    </div>
  );
}
