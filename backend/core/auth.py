# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""Dashboard API key middleware.

All routes NOT in the PROBE_EXEMPT set require an X-OW-Key header that matches
the DASHBOARD_API_KEY environment variable.  Probe routes authenticate via HMAC
and are explicitly exempted here.

If DASHBOARD_API_KEY is not set (local dev), the middleware passes everything
through so you can work without configuring auth.
"""

from __future__ import annotations

import os
import re

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

DASHBOARD_API_KEY: str = os.getenv("DASHBOARD_API_KEY", "")

# Paths that do NOT need an X-OW-Key header.
# Probe routes carry HMAC auth inside the endpoint handlers.
_EXEMPT = re.compile(
    r"^("
    r"/health"                     # root liveness probe (Railway)
    r"|/docs"                      # Swagger UI
    r"|/redoc"                     # ReDoc
    r"|/openapi\.json"             # schema
    r"|/api/v1/ingest/"            # direct ingest (probe)
    r"|.*/probe/register"          # probe registration
    r"|.*/probe/push"              # probe metric push
    r"|.*/probe/config"            # probe remote config pull
    r")"
)


class APIKeyMiddleware(BaseHTTPMiddleware):
    """Rejects requests without a valid X-OW-Key header on management routes."""

    async def dispatch(self, request: Request, call_next):
        # Dev mode: no key configured → open access
        if not DASHBOARD_API_KEY:
            return await call_next(request)

        # Always allow OPTIONS (CORS pre-flight) to pass through
        if request.method == "OPTIONS":
            return await call_next(request)

        # Exempt probe / health paths
        if _EXEMPT.match(request.url.path):
            return await call_next(request)

        # Validate key
        key = request.headers.get("X-OW-Key", "")
        if key != DASHBOARD_API_KEY:
            return JSONResponse(
                {"detail": "Unauthorized — missing or invalid X-OW-Key"},
                status_code=401,
            )

        return await call_next(request)
