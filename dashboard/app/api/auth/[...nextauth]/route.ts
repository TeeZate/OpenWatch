// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
