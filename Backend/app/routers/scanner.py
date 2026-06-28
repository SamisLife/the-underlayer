"""SSH-engine routes: ESP32 Bluetooth intake, direct host scanning (debug), and
remediation command execution.

These handlers are synchronous (`def`) because they drive blocking paramiko I/O;
FastAPI runs them in its worker thread pool, keeping the event loop free.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, BackgroundTasks

from ..bridge import run_blocking
from ..config import ENGINE_VERSION
from ..db import db
from ..models import (
    BluetoothScanPayload,
    DirectScanRequest,
    MatchedDevice,
    RunCommandRequest,
)
from ..ssh.classify import build_matched_device
from ..ssh.commands import run_command_on_host
from ..ssh.parsers import build_scan_document
from ..ssh.pipeline import post_to_relay, run_ssh_scan, save_scan_log
from ..ssh.scanner import SSHScanner

log = logging.getLogger("underlayer.ssh")

router = APIRouter()


@router.post("/api/bluetooth/scan")
def bluetooth_scan(
    payload: BluetoothScanPayload,
    background_tasks: BackgroundTasks,
):
    """
    Receive ESP32 Bluetooth scan, classify devices, queue SSH scans.
    Returns immediately; all I/O happens in background threads.

    ESP32 POST body example:
    {
      "scanner_id": "specter-01",
      "devices": [
        {"name": "ubuntu", "mac": "AA:BB:CC:DD:EE:FF", "rssi": -65}
      ]
    }
    """
    results = []

    # Log all devices seen by ESP32 (BLE + Wi-Fi)
    log.info("ESP32 scan received %d devices:", len(payload.devices))
    for bt in payload.devices:
        log.info("  - %s (MAC: %s, RSSI: %s)", bt.name, bt.mac, bt.rssi)

    # Clear previous scan results in the relay database (direct in-process call;
    # this sync route runs in a worker thread, so it bridges to the event loop).
    try:
        run_blocking(db.devices.delete_many({}))
        log.info("Cleared previous devices in Relay MongoDB")
    except Exception as e:
        log.warning("Failed to clear relay database before scan: %s", e)

    ssh_targets = []
    for bt in payload.devices:
        matched = build_matched_device(bt)

        if not matched:
            results.append({
                "name":        bt.name,
                "mac":         bt.mac,
                "recognized":  False,
                "device_type": None,
                "ssh_scan":    None,
            })
            continue

        entry: Dict[str, Any] = {
            "name":        matched.bt_name,
            "mac":         matched.bt_mac,
            "recognized":  True,
            "device_type": matched.device_type,
            "vendor":      matched.vendor,
            "ssh_capable": matched.ssh_capable,
            "distance_m":  matched.distance_m,
        }

        # Compute the ssh status for the stub
        if matched.ssh_capable and matched.hostname:
            stub_ssh_status = "queued"
        elif matched.ssh_capable and not matched.hostname:
            stub_ssh_status = "no_host_record"
        else:
            stub_ssh_status = "not_applicable"

        # Always forward a stub to relay instantly so AR displays it immediately
        stub: Dict[str, Any] = {
            "hostname":  matched.bt_name or matched.bt_mac or "unknown",
            "device_id": matched.bt_mac or matched.bt_name,
            "mac":       matched.bt_mac,
            "ip":        matched.hostname if matched.ssh_capable else None,
            "position": {
                "distance_m": matched.distance_m,
                "rssi":       float(matched.rssi) if matched.rssi is not None else None,
            } if matched.rssi is not None else None,
            "scan_metadata": {
                "scan_time":         datetime.now(timezone.utc).isoformat(),
                "collector_version": ENGINE_VERSION,
                "ssh_status":        stub_ssh_status,
            },
            "device_type": matched.device_type,
            "vendor":      matched.vendor,
            "bt_name":     matched.bt_name,
        }
        post_to_relay(stub)

        # Collect SSH capable devices for later queuing
        if matched.ssh_capable and matched.hostname:
            ssh_targets.append(matched)
            entry["ssh_scan"] = "queued"
            entry["hostname"] = matched.hostname
        elif matched.ssh_capable and not matched.hostname:
            entry["ssh_scan"] = "no_host_record"
        else:
            entry["ssh_scan"] = "not_applicable"

        results.append(entry)

    # Queue SSH scans AFTER all stubs have been queued, so stubs don't get blocked
    for target in ssh_targets:
        background_tasks.add_task(run_ssh_scan, target)

    return {
        "received":   len(payload.devices),
        "recognized": sum(1 for r in results if r["recognized"]),
        "ssh_queued": sum(1 for r in results if r.get("ssh_scan") == "queued"),
        "devices":    results,
    }


@router.post("/api/debug/scan-host")
def debug_scan_host(req: DirectScanRequest):
    """
    Synchronous test endpoint — SSH into a host directly and return the raw
    scan JSON. Does NOT require a BT scan or hosts.json entry.
    Set forward_to_relay=true to also POST the result to relay.

    curl example:
      curl -s -X POST http://localhost:8000/api/debug/scan-host \\
        -H "Content-Type: application/json" \\
        -d '{"hostname":"192.168.1.100","username":"ubuntu","password":"secret"}'
    """
    scan_start = datetime.now(timezone.utc).isoformat()

    scanner = SSHScanner(
        host     = req.hostname,
        port     = req.port,
        username = req.username or "ubuntu",
        password = req.password or "",
        key_path = req.key_path or "",
    )

    if not scanner.connect():
        return {
            "ok":    False,
            "error": "SSH connection failed",
            "host":  req.hostname,
            "port":  req.port,
            "user":  req.username or "ubuntu",
        }

    try:
        raw = scanner.collect()
    finally:
        scanner.close()

    # Build a minimal MatchedDevice so build_scan_document has position fields
    matched = MatchedDevice(hostname=req.hostname, ssh_port=req.port)
    doc = build_scan_document(raw, matched, scan_start)

    log_path = save_scan_log(doc)

    if req.forward_to_relay:
        ok = post_to_relay(doc)
        doc["_forwarded_to_relay"] = ok

    return {"ok": True, "log": str(log_path), "scan": doc}


@router.post("/api/ssh/run-command")
def run_command(req: RunCommandRequest):
    """
    Run an arbitrary command on the target host via SSH.
    It looks up the credentials from hosts.json via the hostname.
    """
    return run_command_on_host(req.hostname, req.command)
