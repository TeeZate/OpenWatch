// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginCard() {
  const params       = useSearchParams();
  const error        = params.get("error");
  const callbackUrl  = params.get("callbackUrl") ?? "/";

  const denied = error === "AccessDenied";

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="text-2xl font-bold text-white tracking-tight">
              Open<span className="text-blue-400">Watch</span>
            </span>
          </div>
          <p className="text-sm text-zinc-500">System Health Monitoring Platform</p>
        </div>

        {/* Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl">
          <h1 className="text-lg font-semibold text-white mb-1">Sign in</h1>
          <p className="text-sm text-zinc-500 mb-6">
            Use your GitHub account to access the dashboard.
          </p>

          {/* Error banner */}
          {denied && (
            <div className="mb-5 rounded-lg bg-red-950/60 border border-red-800 px-4 py-3 text-sm text-red-300">
              Access denied. This dashboard is restricted to authorised accounts.
            </div>
          )}
          {error && !denied && (
            <div className="mb-5 rounded-lg bg-yellow-950/60 border border-yellow-800 px-4 py-3 text-sm text-yellow-300">
              Sign-in error: {error}. Please try again.
            </div>
          )}

          <button
            onClick={() => signIn("github", { callbackUrl })}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-zinc-100 text-zinc-900 font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            {/* GitHub mark */}
            <svg height="20" viewBox="0 0 16 16" width="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                   0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                   -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
                   .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
                   -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0
                   1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
                   1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01
                   1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
              />
            </svg>
            Continue with GitHub
          </button>
        </div>

        <p className="text-center text-xs text-zinc-700 mt-6">
          OpenWatch &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginCard />
    </Suspense>
  );
}
