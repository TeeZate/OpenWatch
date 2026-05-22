// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

/**
 * Next.js middleware — protects every route except:
 *   /login            — sign-in page (unauthenticated)
 *   /api/auth/**      — NextAuth OAuth flow callbacks
 *   /_next/**         — Next.js static assets
 *   /favicon.ico      — browser default request
 *
 * next-auth/middleware reads the session JWT from the cookie and
 * redirects unauthenticated requests to `pages.signIn` (/login).
 */
export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
