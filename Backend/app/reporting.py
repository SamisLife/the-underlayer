"""Human-readable scan logging and JSON report persistence."""

import json
import logging
import os
from datetime import datetime
from typing import Any, Dict

from .config import REPORTS_DIR

log = logging.getLogger("underlayer.relay")


def log_scan_summary(scan_dict: Dict[str, Any], ar_summary: Dict[str, Any], scan_id: str, vuln_hits: list = []) -> None:
    SEV_PAD = {"critical": "CRITICAL", "high": "HIGH", "medium": "MEDIUM", "low": "LOW"}

    hostname  = scan_dict.get("hostname", "?")
    bt_name   = scan_dict.get("bt_name") or ""
    os_info   = scan_dict.get("os") or {}
    hw_info   = scan_dict.get("hardware") or {}
    users     = scan_dict.get("users") or []
    network   = scan_dict.get("network") or {}
    ports     = network.get("open_ports") or []
    sec_upd   = scan_dict.get("security_updates") or {}
    severity  = ar_summary.get("threatLevel", "unknown")
    findings  = ar_summary.get("findings") or []
    apt_pkgs  = scan_dict.get("apt_packages") or []
    services  = scan_dict.get("services") or []
    suid_bins = scan_dict.get("suid_binaries") or []
    docker    = scan_dict.get("docker") or {}
    python_i  = scan_dict.get("python") or {}
    node_i    = scan_dict.get("nodejs") or {}
    databases = scan_dict.get("databases") or []
    env_info  = scan_dict.get("environment") or {}

    pretty_os = os_info.get("pretty_name") or os_info.get("name") or "unknown OS"
    kernel    = os_info.get("kernel") or "?"
    arch      = os_info.get("architecture") or "?"
    cpu       = hw_info.get("cpu_model") or "?"
    cores     = hw_info.get("cpu_cores", "?")
    mem       = hw_info.get("memory_mb", "?")

    label     = SEV_PAD.get(severity, severity.upper())
    bt_tag    = f"  (bt: {bt_name})" if bt_name else ""
    sep       = "─" * 64

    log.info(sep)
    log.info("SCAN  %s%s  ──  severity: %s", hostname, bt_tag, label)
    log.info("  OS        : %s  /  %s  (%s)", pretty_os, kernel, arch)
    log.info("  Hardware  : %s  •  %s cores  •  %s MB RAM", cpu, cores, mem)

    user_str = ", ".join(f"{u.get('username')} (uid {u.get('uid')})" for u in users) or "none"
    log.info("  Users     : %s", user_str)

    log.info("  Packages  : %d apt installed  •  %d services", len(apt_pkgs), len(services))

    if python_i.get("version"):
        log.info("  Python    : %s  (%d packages)", python_i["version"], len(python_i.get("packages") or []))
    if node_i.get("version"):
        log.info("  Node.js   : %s  (%d packages)", node_i["version"], len(node_i.get("packages") or []))
    if docker.get("version"):
        log.info("  Docker    : %s  (%d images, %d containers)",
                 docker["version"], len(docker.get("images") or []), len(docker.get("containers") or []))
    if databases:
        db_str = ", ".join(f"{d.get('type')} {d.get('version') or ''}".strip() for d in databases)
        log.info("  Databases : %s", db_str)

    if ports:
        port_str = "  ".join(
            f"{p.get('port')}/{p.get('protocol','tcp')} ({p.get('service') or '?'})" for p in ports
        )
        log.info("  Open ports: %s", port_str)
    else:
        log.info("  Open ports: none detected")

    if suid_bins:
        log.info("  SUID bins : %d found — %s", len(suid_bins), ", ".join(suid_bins[:5]) +
                 ("…" if len(suid_bins) > 5 else ""))

    sec_count = sec_upd.get("security_updates_available", 0)
    upg_count = sec_upd.get("upgradable_packages", 0)
    log.info("  Sec updates: %d security  •  %d upgradable", sec_count, upg_count)

    if env_info.get("cloud_provider"):
        log.info("  Cloud     : %s  (virtualized: %s)", env_info["cloud_provider"], env_info.get("virtualized"))

    if findings:
        log.info("  Findings  : %d", len(findings))
        for f in findings:
            log.info("    [%s]  %s — %s", f.get("severity", "?").upper(), f.get("title", "?"), f.get("detail", ""))
    else:
        log.info("  Findings  : none")

    if vuln_hits:
        log.info("  CVE hits  : %d match(es)", len(vuln_hits))
        for v in vuln_hits:
            log.info("    %s  %s=%s  →  %s",
                     v.get("cve"), v.get("package") or v.get("service", "?"),
                     v.get("version", ""), v.get("recommended_command", ""))
    else:
        log.info("  CVE hits  : none")

    log.info("  Saved     : scanId=%s  →  MongoDB ✓", scan_id)
    log.info(sep)


def save_report(hostname: str, ts: datetime, ar_summary: dict, vuln_hits: list) -> None:
    try:
        os.makedirs(REPORTS_DIR, exist_ok=True)
        safe_host = hostname.replace(":", "-").replace("/", "-")
        ts_str    = ts.strftime("%Y-%m-%dT%H-%M-%S")
        path      = os.path.join(REPORTS_DIR, f"{safe_host}_{ts_str}.json")

        report = {
            "hostname":    hostname,
            "scannedAt":   ts.isoformat(),
            "severity":    ar_summary.get("threatLevel"),
            "os":          ar_summary.get("os"),
            "openPorts":   ar_summary.get("openPorts", []),
            "findings":    ar_summary.get("findings", []),
            "cveHits":     vuln_hits,
            "summary":     ar_summary.get("summary"),
        }

        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, default=str)

        log.info("  Report    : %s ✓", path)
    except Exception as e:
        log.warning("save_report failed: %s", e)
