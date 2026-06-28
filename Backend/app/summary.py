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
    hostname = scan.get("hostname")
    os_info = scan.get("os") or {}
    network = scan.get("network") or {}
    security_updates = scan.get("security_updates") or {}

    severity = calculate_severity(scan)
    findings = build_findings(scan)

    return {
        "deviceId": scan.get("device_id") or hostname,
        "hostname": hostname,
        "mac": scan.get("mac"),
        "ip": scan.get("ip"),
        "label": hostname,
        "deviceType": scan.get("device_type") or "Unknown",
        "position": scan.get("position"),
        "os": os_info.get("pretty_name") or os_info.get("name") or "Unknown",
        "osVersion": os_info.get("version") or "",
        "kernel": os_info.get("kernel"),
        "severity": severity,
        "statusColor": {
            "critical": "red",
            "high": "red",
            "medium": "amber",
            "low": "green",
        }.get(severity, "gray"),
        "openPorts": network.get("open_ports") or [],
        "securityUpdatesAvailable": security_updates.get("security_updates_available", 0),
        "findings": findings,
        "vulns": len(findings),  # Baseline vulns, updated if CVEs are found
        "summary": f"{hostname} — {severity} risk.",
        "lastScanned": datetime.now(timezone.utc).isoformat(),
        "scanMetadata": scan.get("scan_metadata") or {}
    }
