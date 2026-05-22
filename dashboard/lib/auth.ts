// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

import type { NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";

/**
 * Single-tenant GitHub OAuth.
 *
 * Set ALLOWED_GITHUB_USER to your GitHub username (case-insensitive).
 * Any other GitHub account that somehow reaches the OAuth flow will be
 * rejected at the signIn callback and redirected to /login?error=AccessDenied.
 *
 * Required env vars (set in Vercel / Railway dashboard):
 *   GITHUB_ID          — OAuth App client ID
 *   GITHUB_SECRET      — OAuth App client secret
 *   NEXTAUTH_SECRET    — random secret (`openssl rand -base64 32`)
 *   NEXTAUTH_URL       — canonical URL of the dashboard (e.g. https://openwatch.example.com)
 *   ALLOWED_GITHUB_USER — your GitHub login handle
 */

const ALLOWED = (process.env.ALLOWED_GITHUB_USER ?? "").toLowerCase().trim();

export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId:     process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
    }),
  ],

  pages: {
    signIn: "/login",
    error:  "/login",
  },

  callbacks: {
    async signIn({ profile }) {
      // If no whitelist is configured (dev mode), allow anyone.
      if (!ALLOWED) return true;

      const login = ((profile as { login?: string }).login ?? "")
        .toLowerCase()
        .trim();

      if (login !== ALLOWED) {
        console.warn(`[auth] Rejected login from GitHub user: ${login}`);
        return false;
      }
      return true;
    },

    // Pass GitHub login through to the session so the UI can display it.
    async jwt({ token, profile }) {
      if (profile) {
        token.githubLogin = (profile as { login?: string }).login ?? "";
      }
      return token;
    },

    async session({ session, token }) {
      (session as typeof session & { githubLogin?: string }).githubLogin =
        token.githubLogin as string | undefined;
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
