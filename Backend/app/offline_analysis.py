"""Offline, rule-based device analysis.

A deterministic fallback for /api/analyze when Gemini is unavailable (no key, rate
limited, or error). Produces the same shape as the AI path — a prioritized list of
`problems` with ready-to-run remediation commands — built from the OSV vulnerability
matches (which carry a `fix_version`) and the rule-based findings. No network, no key.

Command templates mirror the OS-aware rules in the Gemini prompt (see ai.py).
"""

import re
from typing import Any, Dict, List, Optional

_SEV_RANK = {"critical": 3, "high": 2, "medium": 1, "low": 0}
_PRIORITY_LABEL = {"critical": "Critical", "high": "High", "medium": "Medium", "low": "Low"}

# Sensitive services that should not be publicly exposed (port -> name).
_SENSITIVE_PORTS = {5432: "postgresql", 3306: "mysql", 6379: "redis",
                    27017: "mongodb", 9200: "elasticsearch"}


def _is_debian_based(raw_scan: dict) -> bool:
    os_info = raw_scan.get("os") or {}
    name = f"{os_info.get('pretty_name', '')} {os_info.get('name', '')}".lower()
    return any(d in name for d in ("debian", "ubuntu", "kali", "mint", "raspbian", "pop"))


def _ver_key(v: str):
    # Numeric-aware, exception-safe sort key: (1, int) for numeric parts sorts above
    # (0, str) for alpha parts, and same-type parts compare normally.
    return [(1, int(p)) if p.isdigit() else (0, p) for p in re.split(r"[.\-_+]", str(v))]


def _best_fix_version(cves: List[dict]) -> Optional[str]:
    versions = [c.get("fix_version") for c in cves if c.get("fix_version")]
    if not versions:
        return None
    try:
        return max(versions, key=_ver_key)
    except Exception:
        return max(versions)


def _upgrade_command(source: str, pkg: str, fix_version: Optional[str], debian: bool) -> Optional[str]:
    """OS-aware upgrade command. Pins to fix_version when known, else upgrades to latest.

    (OSV's querybatch endpoint returns only vuln IDs, so fix_version is often unknown —
    upgrading to the latest patched release is the correct fallback either way.)
    """
    src = (source or "").lower()
    if src in ("python", "pypi", "pip"):
        target = f"{pkg}=={fix_version}" if fix_version else pkg
        if debian:  # bypass PEP 668 on modern Debian-based systems
            return f"sudo -H pip3 install --upgrade --ignore-installed --break-system-packages {target}"
        return f"sudo -H pip3 install --upgrade {target}"
    if src in ("npm", "node"):
        target = f"{pkg}@{fix_version}" if fix_version else f"{pkg}@latest"
        return f"sudo npm install -g {target}"
    if src in ("apt", "deb"):
        # apt --only-upgrade always targets the latest patched build
        return f"sudo apt-get install --only-upgrade -y {pkg}"
    return None


def _package_problems(vuln_matches: List[dict], debian: bool) -> List[dict]:
    groups: Dict[tuple, List[dict]] = {}
    for m in vuln_matches or []:
        if m.get("package"):
            groups.setdefault((m.get("package"), m.get("version"), m.get("source")), []).append(m)

    problems: List[dict] = []
    for (pkg, ver, source), cves in groups.items():
        worst = max((c.get("severity", "medium") for c in cves), key=lambda s: _SEV_RANK.get(s, 1))
        fix_version = _best_fix_version(cves)
        cmd = _upgrade_command(source, pkg, fix_version, debian)
        if not cmd:
            continue  # unknown ecosystem — can't form a reliable command
        n = len(cves)
        tail = f", fixed in {fix_version}." if fix_version else ". Upgrade to the latest patched release."
        problems.append({
            "priority": _PRIORITY_LABEL.get(worst, "Medium"),
            "description": f"{pkg} {ver}: {n} known CVE{'s' if n != 1 else ''} (worst {worst}){tail}",
            "fixCommand": cmd,
            "fixLabel": f"Upgrade {pkg}",
            "_rank": _SEV_RANK.get(worst, 1),
        })
    return problems


def _finding_problems(raw_scan: dict) -> List[dict]:
    problems: List[dict] = []

    sec = (raw_scan.get("security_updates") or {}).get("security_updates_available", 0)
    if sec:
        problems.append({
            "priority": "High",
            "description": f"{sec} pending security update{'s' if sec != 1 else ''}.",
            "fixCommand": "sudo apt-get update && sudo apt-get upgrade -y",
            "fixLabel": "Apply security updates",
            "_rank": 2,
        })

    for port in (raw_scan.get("network") or {}).get("open_ports") or []:
        p = port.get("port")
        if p in _SENSITIVE_PORTS:
            problems.append({
                "priority": "Medium",
                "description": f"{_SENSITIVE_PORTS[p]} ({p}) is exposed; restrict it to trusted networks.",
                "fixCommand": f"sudo ufw deny {p}/tcp",
                "fixLabel": f"Block port {p}",
                "_rank": 1,
            })

    return problems


def analyze_offline(raw_scan: dict, ar_summary: dict, vuln_matches: List[dict]) -> Dict[str, Any]:
    """Build an AI-shaped analysis result (problems + summary) with no network/key."""
    debian = _is_debian_based(raw_scan)

    problems = _package_problems(vuln_matches, debian) + _finding_problems(raw_scan)
    problems.sort(key=lambda p: p.get("_rank", 1), reverse=True)
    problems = problems[:6]  # the AR UI shows up to 6 (3 per side monitor)
    for p in problems:
        p.pop("_rank", None)

    total_cve = len(vuln_matches or [])
    n_pkg = len({(m.get("package"), m.get("version"), m.get("source")) for m in (vuln_matches or []) if m.get("package")})

    if problems:
        risk = (
            f"{total_cve} CVE{'s' if total_cve != 1 else ''} across {n_pkg} "
            f"package{'s' if n_pkg != 1 else ''}; {len(problems)} prioritized "
            f"fix{'es' if len(problems) != 1 else ''} ready."
        )
        recommendation = "Apply the commands below, highest priority first."
    else:
        risk = "No actionable issues found by the offline analysis."
        recommendation = "No fixes required."

    return {
        "enabled": True,
        "offline": True,
        "risk_summary": risk,
        "recommendation": recommendation,
        "reasoning": ["Generated offline from OSV vulnerability data and scan findings (no AI key required)."],
        "problems": problems,
    }
