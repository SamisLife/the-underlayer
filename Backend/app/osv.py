"""OSV vulnerability lookup.

Two-pass query of the OSV database (https://osv.dev/) for every pip / npm / apt package:
  1. /v1/querybatch — one cheap batched call that returns vuln ID *stubs*, used only to
     find which packages have vulnerabilities.
  2. /v1/query — a per-package call (concurrent, only for the vulnerable packages) that
     returns the *full* vuln objects, which carry the real severity and fixed versions.
querybatch alone returns stubs (no severity / no fixed version), so pass 2 is what makes
threat levels accurate and lets the analyzers pin exact upgrade versions.

Results are cached in-process by (name, version, ecosystem) so repeated scans don't re-hit
the network.
"""

import asyncio
import logging
import re

import httpx

log = logging.getLogger("underlayer.osv")


def _ver_key(v: str):
    # Numeric-aware, exception-safe version sort key.
    return [(1, int(p)) if p.isdigit() else (0, p) for p in re.split(r"[.\-_+]", str(v))]


def _applicable_fix(vuln: dict, installed: str):
    """The fixed version a host should upgrade to: the smallest ECOSYSTEM fix above the
    installed version (falls back to the highest fix). Skips GIT ranges (commit hashes)."""
    fixes = [
        event["fixed"]
        for affected in vuln.get("affected") or []
        for rng in affected.get("ranges") or []
        if rng.get("type") == "ECOSYSTEM"
        for event in rng.get("events") or []
        if "fixed" in event
    ]
    if not fixes:
        return None
    try:
        if installed:
            higher = [f for f in fixes if _ver_key(f) > _ver_key(installed)]
            if higher:
                return min(higher, key=_ver_key)
        return max(fixes, key=_ver_key)
    except Exception:
        return fixes[0]

_osv_cache: dict = {}          # (name, version, ecosystem) -> list[vuln]
_OSV_CACHE_MAX = 2000
_OSV_BATCH_SIZE = 100
_OSV_CONCURRENCY = 12          # max concurrent /v1/query enrichment requests
_OSV_TIMEOUT = 12.0            # seconds per HTTP request


async def _query_osv_batch(queries: list) -> list:
    """POST /v1/querybatch to OSV. Returns a list of vuln-lists in the same order."""
    try:
        async with httpx.AsyncClient(timeout=_OSV_TIMEOUT) as client:
            resp = await client.post(
                "https://api.osv.dev/v1/querybatch",
                json={"queries": queries},
            )
            resp.raise_for_status()
            return [r.get("vulns") or [] for r in resp.json().get("results", [])]
    except Exception as e:
        log.warning("OSV batch query failed: %s", e)
        return [[] for _ in queries]


async def _query_osv_package(client: httpx.AsyncClient, query: dict) -> list:
    """POST /v1/query for one package — returns full vuln objects (severity + fixed versions)."""
    try:
        resp = await client.post("https://api.osv.dev/v1/query", json=query)
        resp.raise_for_status()
        return resp.json().get("vulns") or []
    except Exception as e:
        log.warning("OSV detail query failed for %s: %s", (query.get("package") or {}).get("name"), e)
        return []


async def check_osv_vulnerabilities(raw_scan: dict) -> list:
    """
    Query OSV for every pip / npm / apt package in the scan.
    Results are cached in-process by (name, version, ecosystem) so repeated
    scans of the same host don't re-hit the network.
    """
    os_info = raw_scan.get("os") or {}
    pretty_os = (os_info.get("pretty_name") or os_info.get("name") or "").lower()
    apt_ecosystem = "Ubuntu" if "ubuntu" in pretty_os else "Debian"

    # Build flat list: (meta, osv_query)
    to_query: list[tuple[dict, dict]] = []

    python_info = raw_scan.get("python") or {}
    for pkg in python_info.get("packages") or []:
        if pkg.get("name") and pkg.get("version"):
            to_query.append((
                {"source": "python", "name": pkg["name"], "version": pkg["version"]},
                {"package": {"name": pkg["name"], "ecosystem": "PyPI"}, "version": pkg["version"]},
            ))

    node_info = raw_scan.get("nodejs") or {}
    for pkg in node_info.get("packages") or []:
        if pkg.get("name") and pkg.get("version"):
            to_query.append((
                {"source": "npm", "name": pkg["name"], "version": pkg["version"]},
                {"package": {"name": pkg["name"], "ecosystem": "npm"}, "version": pkg["version"]},
            ))

    for pkg in raw_scan.get("apt_packages") or []:
        if pkg.get("name") and pkg.get("version"):
            to_query.append((
                {"source": "apt", "name": pkg["name"], "version": pkg["version"]},
                {"package": {"name": pkg["name"], "ecosystem": apt_ecosystem}, "version": pkg["version"]},
            ))

    if not to_query:
        return []

    # Separate cached from uncached
    results_map: dict[int, list] = {}
    uncached: list[tuple[int, dict, dict]] = []

    for i, (meta, query) in enumerate(to_query):
        key = (query["package"]["name"], query.get("version", ""), query["package"]["ecosystem"])
        if key in _osv_cache:
            results_map[i] = _osv_cache[key]
        else:
            uncached.append((i, meta, query))

    # Evict oldest half if cache is full
    if len(_osv_cache) > _OSV_CACHE_MAX:
        for k in list(_osv_cache.keys())[: _OSV_CACHE_MAX // 2]:
            del _osv_cache[k]

    # Pass 1 — querybatch (cheap, batched) to find which uncached packages have vulns.
    for chunk_start in range(0, len(uncached), _OSV_BATCH_SIZE):
        chunk = uncached[chunk_start : chunk_start + _OSV_BATCH_SIZE]
        vuln_lists = await _query_osv_batch([q for (_, _, q) in chunk])
        for (orig_idx, meta, query), vulns in zip(chunk, vuln_lists):
            results_map[orig_idx] = vulns  # ID stubs only for now

    # Pass 2 — enrich just the vulnerable packages via /v1/query to get full vuln objects
    # (real severity + fixed versions). Concurrent + bounded; a failure keeps the stub.
    to_enrich = [(i, q) for (i, _, q) in uncached if results_map.get(i)]
    if to_enrich:
        sem = asyncio.Semaphore(_OSV_CONCURRENCY)

        async def _enrich(idx: int, query: dict):
            async with sem:
                return idx, await _query_osv_package(client, query)

        async with httpx.AsyncClient(timeout=_OSV_TIMEOUT) as client:
            for fut in asyncio.as_completed([_enrich(i, q) for i, q in to_enrich]):
                idx, full = await fut
                if full:
                    results_map[idx] = full

    # Cache the final (enriched) per-package result.
    for (orig_idx, meta, query) in uncached:
        key = (query["package"]["name"], query.get("version", ""), query["package"]["ecosystem"])
        _osv_cache[key] = results_map.get(orig_idx, [])

    # Flatten into match dicts
    _sev_map = {"CRITICAL": "critical", "HIGH": "high",
                "MODERATE": "medium", "MEDIUM": "medium", "LOW": "low"}
    matches = []

    for i, (meta, _) in enumerate(to_query):
        for vuln in results_map.get(i) or []:
            db_specific = vuln.get("database_specific") or {}
            severity = _sev_map.get((db_specific.get("severity") or "").upper(), "medium")

            # The version this host should upgrade to (ECOSYSTEM ranges only — no GIT hashes).
            fix_version = _applicable_fix(vuln, meta.get("version"))

            # Prefer a CVE- alias over the GHSA id
            cve_id = next(
                (a for a in (vuln.get("aliases") or []) if a.startswith("CVE-")),
                vuln["id"],
            )

            matches.append({
                "source":              meta["source"],
                "package":             meta["name"],
                "version":             meta["version"],
                "cve":                 cve_id,
                "ghsa":                vuln["id"],
                "severity":            severity,
                "summary":             vuln.get("summary") or "",
                "fix_version":         fix_version,
                "recommended_command": None,  # populated only by /api/analyze/{hostname}
            })

    # Deduplicate: GHSA and PYSEC records often reference the same underlying CVE.
    # Keep the first occurrence of each (package, version, cve_id) triple.
    seen: set = set()
    deduped: list = []
    for m in matches:
        key = (m["package"], m["version"], m["cve"])
        if key not in seen:
            seen.add(key)
            deduped.append(m)

    return deduped
