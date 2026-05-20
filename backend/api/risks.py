# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Request

from db.redis_client import RISKS_KEY
from models.responses import RiskItem, RisksResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["risks"])


@router.get("/risks", response_model=RisksResponse)
async def get_risks(request: Request) -> RisksResponse:
    """
    Return risk items ranked by severity.
    Populated by the intelligence consumer (version checks + AI summaries).
    Returns an empty list if no risks have been computed yet.
    """
    redis = request.app.state.redis
    raw   = await redis.get(RISKS_KEY)

    if not raw:
        return RisksResponse(risks=[], generated_at=datetime.now(timezone.utc))

    data = json.loads(raw)
    risks = [RiskItem(**item) for item in data.get("risks", [])]

    # Sort: critical first, then warning, then watch
    _order = {"critical": 0, "warning": 1, "watch": 2}
    risks.sort(key=lambda r: _order.get(r.severity, 9))

    generated_at = data.get("generated_at")
    return RisksResponse(
        risks=risks,
        generated_at=datetime.fromisoformat(generated_at) if generated_at else datetime.now(timezone.utc),
    )
