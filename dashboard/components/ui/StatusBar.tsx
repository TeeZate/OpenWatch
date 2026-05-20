"use client";
// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import type { HealthSummary } from "@/lib/api";

interface Props {
  summary: HealthSummary;
  lastUpdated?: string;
  children?: React.ReactNode;
}

export function StatusBar({ summary, lastUpdated, children }: Props) {
  return (
    <div className="flex items-center gap-6 px-4 py-2 bg-gray-900 border-b border-gray-800 text-sm">
      <span className="font-bold text-white tracking-wide">OpenWatch</span>

      <div className="flex items-center gap-4 ml-4">
        <Pill color="green"  label="Up"       count={summary.up}       />
        <Pill color="yellow" label="Degraded" count={summary.degraded} />
        <Pill color="red"    label="Down"     count={summary.down}     />
        <Pill color="gray"   label="Unknown"  count={summary.unknown}  />
      </div>

      {children}
      <span className="ml-auto text-gray-500 text-xs">
        {summary.total} service{summary.total !== 1 ? "s" : ""}
        {lastUpdated ? ` · ${new Date(lastUpdated).toLocaleTimeString()}` : ""}
      </span>
    </div>
  );
}

function Pill({
  color,
  label,
  count,
}: {
  color: "green" | "yellow" | "red" | "gray";
  label: string;
  count: number;
}) {
  const dot: Record<string, string> = {
    green:  "bg-green-500",
    yellow: "bg-yellow-400",
    red:    "bg-red-500",
    gray:   "bg-gray-500",
  };
  const text: Record<string, string> = {
    green:  "text-green-400",
    yellow: "text-yellow-300",
    red:    "text-red-400",
    gray:   "text-gray-400",
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${dot[color]}`} />
      <span className={`${text[color]} font-medium`}>{count}</span>
      <span className="text-gray-500">{label}</span>
    </span>
  );
}
