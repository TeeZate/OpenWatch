# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""
Version intelligence — queries PyPI, npm, and OSV.dev to flag packages that
are outdated or have known CVEs.

All results are cached in Redis with a 1-hour TTL to avoid hammering public
APIs on every agent tick.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional

import httpx
from redis.asyncio import Redis

logger = logging.getLogger(__name__)

CACHE_TTL = 3600  # 1 hour

_PYPI_URL  = "https://pypi.org/pypi/{name}/json"
_NPM_URL   = "https://registry.npmjs.org/{name}/latest"
_OSV_URL   = "https://api.osv.dev/v1/query"


@dataclass
class PackageRisk:
    name: str
    version: str
    ecosystem: str
    latest_version: Optional[str]
    versions_behind: int                 # difference in major versions
    cves: list[str] = field(default_factory=list)
    is_outdated: bool = False
    has_cve: bool = False


async def check_packages(
    packages: list[dict],
    redis: Redis,
    http: httpx.AsyncClient,
) -> list[PackageRisk]:
    """
    Check a list of packages for outdated versions and CVEs.
    packages: list of {"name": str, "version": str, "ecosystem": str}
    """
    results: list[PackageRisk] = []

    for pkg in packages:
        name      = pkg.get("name", "")
        version   = pkg.get("version", "")
        ecosystem = pkg.get("ecosystem", "")

        if not name or not version or not ecosystem:
            continue

        risk = await _check_one(name, version, ecosystem, redis, http)
        if risk.is_outdated or risk.has_cve:
            results.append(risk)

    return results


async def _check_one(
    name: str,
    version: str,
    ecosystem: str,
    redis: Redis,
    http: httpx.AsyncClient,
) -> PackageRisk:
    risk = PackageRisk(
        name=name,
        version=version,
        ecosystem=ecosystem,
        latest_version=None,
        versions_behind=0,
    )

    # Latest version check
    latest = await _get_latest(name, ecosystem, redis, http)
    if latest:
        risk.latest_version = latest
        behind = _major_versions_behind(version, latest)
        risk.versions_behind = behind
        risk.is_outdated = behind >= 2

    # CVE check via OSV.dev
    cves = await _get_cves(name, version, ecosystem, redis, http)
    risk.cves = cves
    risk.has_cve = bool(cves)

    return risk


# ── Latest version queries ────────────────────────────────────────────────────

async def _get_latest(
    name: str,
    ecosystem: str,
    redis: Redis,
    http: httpx.AsyncClient,
) -> Optional[str]:
    cache_key = f"version:latest:{ecosystem}:{name}"
    cached = await redis.get(cache_key)
    if cached:
        return cached

    latest = None
    try:
        if ecosystem == "PyPI":
            latest = await _pypi_latest(name, http)
        elif ecosystem == "npm":
            latest = await _npm_latest(name, http)
    except Exception as exc:
        logger.warning("version check failed %s/%s: %s", ecosystem, name, exc)

    if latest:
        await redis.set(cache_key, latest, ex=CACHE_TTL)
    return latest


async def _pypi_latest(name: str, http: httpx.AsyncClient) -> Optional[str]:
    resp = await http.get(_PYPI_URL.format(name=name), timeout=5)
    if resp.status_code != 200:
        return None
    data = resp.json()
    return data.get("info", {}).get("version")


async def _npm_latest(name: str, http: httpx.AsyncClient) -> Optional[str]:
    resp = await http.get(_NPM_URL.format(name=name), timeout=5)
    if resp.status_code != 200:
        return None
    return resp.json().get("version")


# ── CVE queries via OSV.dev ───────────────────────────────────────────────────

async def _get_cves(
    name: str,
    version: str,
    ecosystem: str,
    redis: Redis,
    http: httpx.AsyncClient,
) -> list[str]:
    cache_key = f"version:cves:{ecosystem}:{name}:{version}"
    cached = await redis.get(cache_key)
    if cached is not None:
        return cached.split(",") if cached else []

    cves: list[str] = []
    try:
        payload = {
            "version": version,
            "package": {"name": name, "ecosystem": ecosystem},
        }
        resp = await http.post(_OSV_URL, json=payload, timeout=8)
        if resp.status_code == 200:
            data = resp.json()
            for vuln in data.get("vulns", []):
                cves.append(vuln.get("id", ""))
    except Exception as exc:
        logger.warning("OSV query failed %s/%s@%s: %s", ecosystem, name, version, exc)

    await redis.set(cache_key, ",".join(cves), ex=CACHE_TTL)
    return [c for c in cves if c]


# ── Semver comparison ─────────────────────────────────────────────────────────

def _major_versions_behind(current: str, latest: str) -> int:
    """Return how many major versions current is behind latest. Returns 0 on parse error."""
    try:
        cur_major = _parse_major(current)
        lat_major = _parse_major(latest)
        return max(0, lat_major - cur_major)
    except Exception:
        return 0


_ver_re = re.compile(r"^(\d+)")


def _parse_major(version: str) -> int:
    version = version.lstrip("v")
    m = _ver_re.match(version)
    if not m:
        raise ValueError(f"cannot parse version: {version}")
    return int(m.group(1))
