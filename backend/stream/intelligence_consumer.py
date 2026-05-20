# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import httpx
from aiokafka import AIOKafkaConsumer
from neo4j import AsyncDriver
from redis.asyncio import Redis

from intelligence.ai_summariser import AISummariser
from intelligence.version_checker import PackageRisk, check_packages
from models.events import AgentEvent
from stream.producer import TOPIC_AGENT_EVENTS

logger = logging.getLogger(__name__)

CONSUMER_GROUP = "openwatch-intelligence"
RISKS_KEY      = "risks:latest"
RISKS_TTL      = 600  # 10 minutes

# Cypher: find all services reachable within 2 hops of a given hostname's services.
_BLAST_RADIUS_QUERY = """
MATCH (h:Host {hostname: $hostname})-[:RUNS]->(s:Service)
OPTIONAL MATCH (s)-[:RUNS|CONNECTS_TO*1..2]-(neighbor:Service)
RETURN collect(DISTINCT s.id) AS direct,
       collect(DISTINCT neighbor.id) AS connected
"""


class IntelligenceConsumer:
    """
    Consumes agent.events, runs version checks, queries Ollama for plain-English
    summaries with blast radius context, and writes risk items to Redis.
    """

    def __init__(
        self,
        bootstrap_servers: str,
        redis: Redis,
        neo4j_driver: AsyncDriver | None = None,
    ) -> None:
        self._bootstrap    = bootstrap_servers
        self._redis        = redis
        self._neo4j        = neo4j_driver
        self._consumer: AIOKafkaConsumer | None = None
        self._http         = httpx.AsyncClient(
            headers={"User-Agent": "openwatch-intelligence/0.1"},
            follow_redirects=True,
        )
        ollama_url = os.environ.get("OLLAMA_URL", "http://localhost:11434")
        self._ai   = AISummariser(ollama_url=ollama_url)
        self._ai_available: bool | None = None   # checked lazily once

    async def run(self) -> None:
        self._consumer = AIOKafkaConsumer(
            TOPIC_AGENT_EVENTS,
            bootstrap_servers=self._bootstrap,
            group_id=CONSUMER_GROUP,
            auto_offset_reset="earliest",
            value_deserializer=lambda b: json.loads(b.decode()),
            enable_auto_commit=True,
        )
        await self._consumer.start()
        logger.info(
            "IntelligenceConsumer started (group=%s topic=%s)",
            CONSUMER_GROUP,
            TOPIC_AGENT_EVENTS,
        )

        try:
            async for msg in self._consumer:
                await self._handle(msg.value)
        except asyncio.CancelledError:
            logger.info("IntelligenceConsumer shutting down")
        finally:
            await self._consumer.stop()
            await self._http.aclose()

    async def _handle(self, raw: dict) -> None:
        try:
            event = AgentEvent.model_validate(raw)
        except Exception as exc:
            logger.warning("Intelligence: invalid event payload: %s", exc)
            return

        packages = raw.get("packages", [])
        if not packages:
            return

        logger.debug(
            "Intelligence: checking %d packages agent_id=%s",
            len(packages),
            event.agent_id,
        )

        try:
            risks = await check_packages(packages, self._redis, self._http)
            if not risks:
                return

            blast = await self._blast_radius(event.hostname)
            await self._store_risks(risks, event, blast)
            logger.info(
                "Intelligence: %d risks stored agent_id=%s",
                len(risks),
                event.agent_id,
            )
        except Exception as exc:
            logger.error("Intelligence: processing failed: %s", exc)

    # ── Blast radius ─────────────────────────────────────────────────────────

    async def _blast_radius(self, hostname: str) -> dict:
        """Return {direct: [...], connected: [...]} service IDs for a host."""
        if not self._neo4j:
            return {"direct": [], "connected": []}
        try:
            async with self._neo4j.session() as session:
                result = await session.run(_BLAST_RADIUS_QUERY, hostname=hostname)
                record = await result.single()
                if record:
                    return {
                        "direct":    list(record["direct"] or []),
                        "connected": list(record["connected"] or []),
                    }
        except Exception as exc:
            logger.warning("Blast radius query failed: %s", exc)
        return {"direct": [], "connected": []}

    # ── Risk storage ──────────────────────────────────────────────────────────

    async def _store_risks(
        self,
        risks: list[PackageRisk],
        event: AgentEvent,
        blast: dict,
    ) -> None:
        # Check Ollama availability once per process lifetime
        if self._ai_available is None:
            self._ai_available = await self._ai.is_available(self._http)
            logger.info("Ollama available: %s", self._ai_available)

        items = []
        for r in risks:
            severity = (
                "critical" if r.has_cve and r.is_outdated else
                "warning"  if r.has_cve or r.versions_behind >= 2 else
                "watch"
            )

            affected = [
                s.id for s in event.services
                if r.name.replace("-", "_") in (s.binary or "").lower()
                   or r.name.lower() in (s.name or "").lower()
            ] or blast["direct"]

            # Build context for the AI
            ctx = {
                "name":              r.name,
                "ecosystem":         r.ecosystem,
                "version":           r.version,
                "latest_version":    r.latest_version,
                "versions_behind":   r.versions_behind,
                "cves":              r.cves,
                "affected_services": affected,
                "connected_services": blast["connected"][:6],  # limit prompt length
                "hostname":          event.hostname,
            }

            # AI summary — falls back to programmatic if Ollama is down
            ai_summary = None
            if self._ai_available:
                ai_summary = await self._ai.summarise(ctx, self._http)

            summary = ai_summary or _programmatic_summary(r)

            items.append({
                "id":                f"pkg-{r.ecosystem}-{r.name}",
                "severity":          severity,
                "title":             _risk_title(r),
                "summary":           summary,
                "affected_services": affected,
                "blast_radius":      _blast_description(blast),
                "recommendation":    _recommendation(r),
                "metadata": {
                    "package":   r.name,
                    "ecosystem": r.ecosystem,
                    "version":   r.version,
                    "latest":    r.latest_version,
                    "cves":      r.cves,
                    "hostname":  event.hostname,
                    "ai_generated": ai_summary is not None,
                },
            })

        payload = json.dumps({
            "risks":        items,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        })
        await self._redis.set(RISKS_KEY, payload, ex=RISKS_TTL)


# ── Formatting helpers ────────────────────────────────────────────────────────

def _risk_title(r: PackageRisk) -> str:
    parts = [f"{r.name} {r.version} ({r.ecosystem})"]
    if r.has_cve:
        parts.append(f"{len(r.cves)} CVE(s)")
    if r.is_outdated:
        parts.append(f"{r.versions_behind} major version(s) behind")
    return " — ".join(parts)


def _programmatic_summary(r: PackageRisk) -> str:
    lines = []
    if r.is_outdated:
        lines.append(
            f"{r.name} is at version {r.version}; latest stable is {r.latest_version} "
            f"({r.versions_behind} major version(s) behind)."
        )
    if r.has_cve:
        lines.append(f"Known vulnerabilities: {', '.join(r.cves)}.")
    return " ".join(lines)


def _blast_description(blast: dict) -> str:
    direct    = len(blast.get("direct", []))
    connected = len(blast.get("connected", []))
    if direct == 0:
        return "No dependent services identified."
    return (
        f"{direct} service(s) directly affected; "
        f"{connected} additional service(s) reachable within 2 hops."
    )


def _recommendation(r: PackageRisk) -> str:
    if r.has_cve and r.is_outdated:
        return f"Upgrade {r.name} to {r.latest_version} immediately — active CVEs present."
    if r.has_cve:
        return f"Patch or upgrade {r.name} — CVE(s) present in version {r.version}."
    if r.is_outdated:
        return f"Upgrade {r.name} to {r.latest_version} before next deployment."
    return ""
