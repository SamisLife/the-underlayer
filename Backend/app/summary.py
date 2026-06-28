"""AR-summary construction: severity heuristics, rule-based findings, and the
ar_summary object the lens consumes.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List


def calculate_severity(scan: Dict[str, Any]) -> str:
    security_updates = scan.get("security_updates") or {}
    security_count = security_updates.get("security_updates_available", 0)

    network = scan.get("network") or {}
    open_ports = network.get("open_ports") or []

    exposed_sensitive_ports = {5432, 3306, 6379, 27017, 9200}
    has_sensitive_port = any(
        port.get("port") in exposed_sensitive_ports
        for port in open_ports
    )

    docker = scan.get("docker") or {}
    images = docker.get("images") or []
    uses_latest_tag = any(image.get("tag") == "latest" for image in images)

    if security_count >= 1 and has_sensitive_port:
        return "critical"
    if security_count >= 1:
        return "high"
    if has_sensitive_port or uses_latest_tag:
        return "medium"
    return "low"


def build_findings(scan: Dict[str, Any]) -> List[Dict[str, Any]]:
    findings = []

    security_updates = scan.get("security_updates") or {}
    security_count = security_updates.get("security_updates_available", 0)

    if security_count > 0:
        findings.append({
            "title": "Security updates available",
            "severity": "high",
            "detail": f"{security_count} security updates are available.",
            "recommendation": "Apply security updates."
        })

    network = scan.get("network") or {}
    open_ports = network.get("open_ports") or []

    for port in open_ports:
        if port.get("port") in [5432, 3306, 6379, 27017, 9200]:
            findings.append({
                "title": f"Sensitive service exposed: {port.get('service')}",
                "severity": "medium",
                "detail": f"Port {port.get('port')} is open.",
                "recommendation": "Restrict this port to trusted internal networks."
            })

    docker = scan.get("docker") or {}
    for image in docker.get("images") or []:
        if image.get("tag") == "latest":
            findings.append({
                "title": "Docker image uses latest tag",
                "severity": "medium",
                "detail": f"{image.get('name')}:latest is being used.",
                "recommendation": "Pin Docker images to specific versions."
            })

    return findings


def build_ar_summary(scan: Dict[str, Any]) -> Dict[str, Any]:
    """Build the ar_summary the lens consumes.

    Field names match the lens's DeviceSummary type (Frontend DeviceTypes.ts) 1:1 — this
    is the canonical contract. ingest_scan fills the CVE-derived fields (cveCount, counts,
    sourceCounts, vulnerabilityMatches) when an OSV lookup finds matches; the zero/empty
    defaults here keep the shape complete even with no findings.
    """
    hostname = scan.get("hostname")
    os_info = scan.get("os") or {}
    hardware = scan.get("hardware") or {}
    network = scan.get("network") or {}

    threat_level = calculate_severity(scan)
    findings = build_findings(scan)

    return {
        "deviceId": scan.get("device_id") or hostname,
        "hostname": hostname,
        "bt_name": scan.get("bt_name"),
        "deviceType": scan.get("device_type") or "Unknown",
        "ip": scan.get("ip") or hostname,
        "scannedAt": datetime.now(timezone.utc).isoformat(),
        "os": os_info.get("pretty_name") or os_info.get("name") or "Unknown",
        "kernel": os_info.get("kernel"),
        "hardware": {
            "cpu": hardware.get("cpu_model") or "Unknown",
            "cores": hardware.get("cpu_cores") or 0,
            "ram_gb": round((hardware.get("memory_mb") or 0) / 1024, 1),
        },
        "users": [u.get("username") for u in (scan.get("users") or []) if u.get("username")],
        "openPorts": network.get("open_ports") or [],
        "summary": f"{hostname} — {threat_level} risk.",
        "threatLevel": threat_level,
        "cveCount": 0,
        "criticalCount": 0,
        "highCount": 0,
        "mediumCount": 0,
        "packageCount": 0,
        "findings": findings,
        "sourceCounts": {},
        "vulnerabilityMatches": [],
        "scanMetadata": scan.get("scan_metadata") or {},
    }
