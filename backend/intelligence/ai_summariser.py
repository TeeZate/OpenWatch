# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""
AI risk summariser — calls a local Ollama instance to generate plain-English
risk summaries with blast radius analysis.

If Ollama is unreachable the caller receives None and the programmatic
summary from version_checker.py is used instead.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_OLLAMA_MODEL   = os.environ.get("OLLAMA_MODEL", "llama3")
_OLLAMA_TIMEOUT = 30  # seconds — LLM inference can be slow on CPU

_SYSTEM_PROMPT = """\
You are a senior site reliability engineer writing risk summaries for a \
system health monitoring dashboard. Your audience is a sysadmin at a \
50-200 person company. Be direct and specific. State: what is at risk, \
what breaks if it fails, and the single most important action to take. \
Write in plain English with no markdown formatting. \
Keep your response under 4 sentences.\
"""


class AISummariser:
    def __init__(self, ollama_url: str) -> None:
        self._url   = ollama_url.rstrip("/")
        self._model = _OLLAMA_MODEL

    async def summarise(
        self,
        risk_context: dict,
        http: httpx.AsyncClient,
    ) -> Optional[str]:
        """
        Generate a plain-English risk summary for one risk item.
        Returns None if Ollama is unreachable or the model returns an error.
        """
        prompt = _build_prompt(risk_context)
        try:
            resp = await http.post(
                f"{self._url}/api/chat",
                json={
                    "model":    self._model,
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {"role": "user",   "content": prompt},
                    ],
                    "stream": False,
                    "options": {
                        "temperature": 0.3,   # low temp for factual, consistent output
                        "num_predict": 200,   # ~4 sentences max
                    },
                },
                timeout=_OLLAMA_TIMEOUT,
            )
            resp.raise_for_status()
            return resp.json()["message"]["content"].strip()
        except httpx.ConnectError:
            logger.warning("Ollama not reachable at %s — using programmatic summary", self._url)
            return None
        except Exception as exc:
            logger.warning("Ollama summarise failed: %s", exc)
            return None

    async def is_available(self, http: httpx.AsyncClient) -> bool:
        """Quick liveness check — returns True if Ollama responds to /api/tags."""
        try:
            resp = await http.get(f"{self._url}/api/tags", timeout=3)
            return resp.status_code == 200
        except Exception:
            return False


def _build_prompt(ctx: dict) -> str:
    """
    Build a structured prompt from risk context so the model has all the
    facts it needs without requiring access to external data.
    """
    lines = [
        f"Package:             {ctx['name']} ({ctx['ecosystem']})",
        f"Installed version:   {ctx['version']}",
    ]
    if ctx.get("latest_version"):
        lines.append(f"Latest version:      {ctx['latest_version']}")
    if ctx.get("versions_behind", 0) > 0:
        lines.append(f"Major versions behind: {ctx['versions_behind']}")
    if ctx.get("cves"):
        lines.append(f"Known CVEs:          {', '.join(ctx['cves'])}")
    if ctx.get("affected_services"):
        lines.append(f"Services using this package: {', '.join(ctx['affected_services'])}")
    if ctx.get("connected_services"):
        lines.append(f"Services connected to those services: {', '.join(ctx['connected_services'])}")
    if ctx.get("hostname"):
        lines.append(f"Host:                {ctx['hostname']}")

    lines.append("\nWrite a plain-English risk summary for the dashboard.")
    return "\n".join(lines)
