"""Scan-and-forward pipeline: SSH into a matched host, parse its inventory, and
hand the result to the relay's ingest logic.

post_to_relay runs inside a Starlette background task (a worker thread). It calls the
async ingest coroutine directly in-process via the thread→loop bridge — no self-HTTP.
"""

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from ..bridge import run_blocking
from ..config import ENGINE_VERSION, SCAN_DIR
from ..models import DeviceScan, MatchedDevice
from .parsers import build_scan_document
from .scanner import SSHScanner

log = logging.getLogger("underlayer.ssh")


def post_to_relay(scan_doc: Dict[str, Any]) -> bool:
    # Imported lazily to avoid an import cycle (relay → pipeline → relay).
    from ..routers.relay import ingest_scan_document
    try:
        result = run_blocking(ingest_scan_document(DeviceScan(**scan_doc)))
        log.info("Relay ✓  %s  (scanId=%s)",
                 scan_doc.get("hostname"), result.get("scanId"))
        return True
    except Exception as exc:
        log.error("Relay ✗  %s: %s", scan_doc.get("hostname"), exc)
        return False


def save_scan_log(doc: Dict[str, Any]) -> Path:
    """Write the scan document to logs/scans/<hostname>_<timestamp>.json."""
    host = re.sub(r"[^\w.\-]", "_", doc.get("hostname") or "unknown")
    ts   = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    path = SCAN_DIR / f"{host}_{ts}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, default=str)
    log.info("Scan log saved  %s", path)
    return path


def run_ssh_scan(matched: MatchedDevice) -> bool:
    """
    Connect → collect → parse → POST.
    Runs synchronously; called from a Starlette background task (thread pool).
    """
    log.info("SSH scan start  %s @ %s", matched.bt_name, matched.hostname)
    scan_start = datetime.now(timezone.utc).isoformat()

    scanner = SSHScanner(
        host     = matched.hostname,
        port     = matched.ssh_port,
        username = matched.ssh_user     or "ubuntu",
        password = matched.ssh_password or "",
        key_path = matched.ssh_key_path or "",
    )

    if not scanner.connect():
        # Still forward a stub so relay/AR knows the device exists
        post_to_relay({
            "hostname":  matched.hostname or matched.bt_name or "unknown",
            "device_id": matched.bt_mac or matched.hostname,
            "mac":       matched.bt_mac,
            "ip":        matched.hostname,
            "position": {
                "distance_m": matched.distance_m,
                "rssi":       float(matched.rssi) if matched.rssi is not None else None,
            } if matched.rssi is not None else None,
            "scan_metadata": {
                "scan_time":         scan_start,
                "collector_version": ENGINE_VERSION,
                "ssh_error":         "Connection failed",
            },
            "device_type": matched.device_type,
            "vendor":      matched.vendor,
            "bt_name":     matched.bt_name,
        })
        return False

    try:
        raw = scanner.collect()
    finally:
        scanner.close()

    doc = build_scan_document(raw, matched, scan_start)
    doc.setdefault("scan_metadata", {})["ssh_status"] = "completed"

    log.info("SSH scan done   %s — collected %d commands", matched.hostname, len(raw))
    save_scan_log(doc)
    return post_to_relay(doc)
