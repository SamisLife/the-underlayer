"""Relay routes: scan ingest + CVE enrichment, device queries, AI analysis,
remediation approval, topic explanation, ESP32 registration/trigger, and the
WebSocket stream.
"""

import asyncio
import logging
import textwrap
from datetime import datetime, timezone
from typing import List, Optional

import httpx
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from ..ai import analyze_with_ai, explain_topic
from ..config import OFFLINE_ANALYZE_DELAY
from ..models import ApprovalRequest, DeviceScan, LearnRequest, ScannerRegistration
from ..offline_analysis import analyze_offline
from ..osv import check_osv_vulnerabilities
from ..reporting import log_scan_summary, save_report
from ..ssh.commands import run_command_on_host
from ..store import store
from ..summary import build_ar_summary

log = logging.getLogger("underlayer.relay")

router = APIRouter()

class _ScannerRegistry:
    """The ESP32 scanner's self-reported IP, set at runtime via /api/scanner/register."""
    ip: Optional[str] = None


# WebSocket clients + the registered ESP32 scanner are process-wide state for the relay.
connected_clients: List[WebSocket] = []
scanner = _ScannerRegistry()


# ── Broadcast helpers ─────────────────────────────────────────────────────────

async def broadcast_event(event: dict):
    disconnected = []

    for client in connected_clients:
        try:
            await client.send_json(event)
        except Exception:
            disconnected.append(client)

    for client in disconnected:
        if client in connected_clients:
            connected_clients.remove(client)


async def broadcast_device_update(ar_summary: dict):
    await broadcast_event({
        "event": "device_updated",
        "device": ar_summary
    })


# ── Health / devices ──────────────────────────────────────────────────────────

@router.delete("/api/devices")
async def clear_devices():
    """Clears all devices from storage. Called at the start of a new scan session."""
    try:
        deleted = await store.clear_devices()
        return {"status": "ok", "deleted_count": deleted}
    except Exception as e:
        log.error("Failed to clear devices: %s", e)
        return {"status": "error", "error": str(e)}


async def ingest_scan_document(scan: DeviceScan) -> dict:
    """Core scan-ingest: CVE enrichment, persistence, and broadcast.

    Callable both as the /api/scan route body and directly in-process from the SSH
    pipeline (via the thread→loop bridge).
    """
    try:
        log.info("Relay received  %s  (IP: %s  MAC: %s)", scan.hostname, scan.ip, scan.mac)
        scan_dict = scan.model_dump()
        now = datetime.now(timezone.utc)

        ar_summary = build_ar_summary(scan_dict)

        # Live CVE lookup — enriches ar_summary before saving / broadcasting
        vuln_hits = await check_osv_vulnerabilities(scan_dict)
        _sev_rank = {"critical": 3, "high": 2, "medium": 1, "low": 0}

        if vuln_hits:
            # Strip fix data — recommendations are only populated by /api/analyze/{hostname}
            stored_hits = [{k: v for k, v in h.items() if k not in ("fix_version", "recommended_command")}
                           for h in vuln_hits]
            ar_summary["vulnerabilityMatches"] = stored_hits

            # Escalate threat level if any CVE is worse than the heuristic result
            cve_max  = max(_sev_rank.get(v["severity"], 0) for v in vuln_hits)
            cur_rank = _sev_rank.get(ar_summary.get("threatLevel", "low"), 0)
            if cve_max > cur_rank:
                ar_summary["threatLevel"] = ["low", "medium", "high", "critical"][cve_max]

            # Group findings by package — one card line per affected package, not per CVE
            pkg_groups: dict = {}
            for v in vuln_hits:
                key = (v["package"], v["version"], v["source"])
                pkg_groups.setdefault(key, []).append(v)

            cve_findings = []
            source_counts = {}
            for (pkg, ver, src), cves in sorted(
                pkg_groups.items(),
                key=lambda x: -max(_sev_rank.get(c["severity"], 0) for c in x[1]),
            ):
                worst = max(cves, key=lambda c: _sev_rank.get(c["severity"], 0))["severity"]
                n = len(cves)

                src_key = (src or "OS").upper()
                source_counts[src_key] = source_counts.get(src_key, 0) + n

                cve_findings.append({
                    "package":        pkg,
                    "cve_count":      n,
                    "severity":       worst,
                    "source":         src,
                })

            ar_summary["findings"] = cve_findings + (ar_summary.get("findings") or [])

            # Dynamic summary — reflects actual CVE count, not heuristic
            n_cve = len(vuln_hits)
            n_pkg = len(pkg_groups)
            final_sev = ar_summary["threatLevel"]
            ar_summary["summary"] = (
                f"{n_cve} CVE{'s' if n_cve > 1 else ''} across {n_pkg} "
                f"package{'s' if n_pkg > 1 else ''} — {final_sev.upper()} risk"
            )
            ar_summary["cveCount"] = n_cve
            ar_summary["packageCount"] = n_pkg
            ar_summary["criticalCount"] = sum(1 for v in vuln_hits if v["severity"] == "critical")
            ar_summary["highCount"] = sum(1 for v in vuln_hits if v["severity"] == "high")
            ar_summary["mediumCount"] = sum(1 for v in vuln_hits if v["severity"] == "medium")
            ar_summary["sourceCounts"] = source_counts
        else:
            final_sev = ar_summary.get("threatLevel", "low")
            ar_summary["summary"] = f"{scan.hostname} — {final_sev} risk, no known CVEs"

        raw_doc = {
            "hostname": scan.hostname,
            "deviceId": scan.device_id or scan.hostname,
            "mac": scan.mac,
            "ip": scan.ip,
            "receivedAt": now,
            "scanTime": scan.scan_metadata.scan_time if scan.scan_metadata else None,
            "rawScan": scan_dict,
            "arSummary": ar_summary,
        }

        scan_id = await store.save_scan(raw_doc)

        await store.upsert_device(ar_summary["deviceId"], {
            "hostname": scan.hostname,
            "deviceId": scan.device_id or scan.hostname,
            "mac": scan.mac,
            "ip": scan.ip,
            "updatedAt": now,
            "latestScanId": scan_id,
            "latestRawScan": scan_dict,
            "arSummary": ar_summary,
        })

        await broadcast_device_update(ar_summary)

        log_scan_summary(scan_dict, ar_summary, scan_id, vuln_hits)
        save_report(scan.hostname, now, ar_summary, vuln_hits)

        return {
            "success": True,
            "scanId": scan_id,
            "arSummary": ar_summary,
        }
    except Exception:
        log.exception("ingest_scan failed for hostname=%s", scan.hostname)
        raise


@router.post("/api/scan")
async def ingest_scan(scan: DeviceScan):
    return await ingest_scan_document(scan)


@router.post("/api/analyze/{hostname}")
async def analyze_device(hostname: str):
    device = await store.get_device(hostname)

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    raw_scan = device.get("latestRawScan") or {}
    ar_summary = device.get("arSummary") or {}

    # Full OSV matches (with fix_version). The cache is warm from the scan, so this is
    # fast; the analyzers need the fix versions to build upgrade commands.
    matches = await check_osv_vulnerabilities(raw_scan)

    ai_analysis = await analyze_with_ai(raw_scan, ar_summary, matches)
    if not ai_analysis.get("enabled"):
        # Gemini unavailable (no key / rate limit / error) -> deterministic offline analysis.
        # The artificial delay lets the AR "analyzing" animation play.
        log.info("Analyze: Gemini unavailable, using offline analysis for %s", hostname)
        await asyncio.sleep(OFFLINE_ANALYZE_DELAY)
        ai_analysis = analyze_offline(raw_scan, ar_summary, matches)

    log.info(f"ANALYSIS RESULT for {hostname}: {ai_analysis}")

    updated_ar_summary = {
        **ar_summary,
        "vulnerabilityMatches": matches,
        "aiSummary": ai_analysis.get("risk_summary"),
        "aiRecommendation": ai_analysis.get("recommendation"),
        "aiReasoning": ai_analysis.get("reasoning", []),
        "problems": ai_analysis.get("problems", [])
    }

    await store.update_device(hostname, {
        "vulnerabilityMatches": matches,
        "aiAnalysis": ai_analysis,
        "arSummary": updated_ar_summary,
        "analyzedAt": datetime.now(timezone.utc),
    })

    await broadcast_device_update(updated_ar_summary)

    return {
        "success": True,
        "hostname": hostname,
        "vulnerabilityMatches": matches,
        "aiAnalysis": ai_analysis,
        "arSummary": updated_ar_summary
    }


@router.post("/api/approve-action")
async def approve_action(request: ApprovalRequest):
    now = datetime.now(timezone.utc)

    action_doc = {
        "hostname": request.hostname,
        "actionLabel": request.actionLabel,
        "command": request.command,
        "approved": request.approved,
        "status": "approved" if request.approved else "rejected",
        "createdAt": now,
        "sentToSshEngine": False
    }

    message = "Action recorded."

    if request.approved:
        try:
            # The SSH engine now lives in this same process. Run the blocking SSH
            # command in a worker thread so the event loop stays free.
            data = await run_in_threadpool(run_command_on_host, request.hostname, request.command)
            action_doc["sshOutput"] = data.get("stdout") or data.get("error")
            action_doc["sentToSshEngine"] = True
            action_doc["sshSuccess"] = data.get("ok", False)
            message = "Action executed."
        except Exception as e:
            action_doc["sshOutput"] = str(e)
            action_doc["sshSuccess"] = False
            message = "Action failed to execute."

    action_id = await store.save_action(action_doc)

    await broadcast_event({
        "event": "action_recorded",
        "action": {
            "hostname": request.hostname,
            "actionLabel": request.actionLabel,
            "command": request.command,
            "approved": request.approved,
            "status": action_doc["status"],
            "sshSuccess": action_doc.get("sshSuccess", False),
            "sshOutput": action_doc.get("sshOutput")
        }
    })

    return {
        "success": True,
        "actionId": action_id,
        "status": action_doc["status"],
        "message": message,
        "sshOutput": action_doc.get("sshOutput")
    }


@router.post("/api/learn")
async def learn_topic(req: LearnRequest):
    try:
        explanation = await explain_topic(req.topic, req.context)
        # Force word wrapping server-side (around 28 chars per line)
        # This completely prevents Lens Studio from cutting off letters in 3D space
        wrapped_explanation = textwrap.fill(explanation, width=28)
        return {"success": True, "info": wrapped_explanation}
    except Exception as e:
        log.exception("Failed to explain topic: %s", req.topic)
        raise HTTPException(status_code=500, detail=str(e))


# ── Scanner registration / trigger ────────────────────────────────────────────

@router.post("/api/scanner/register")
async def register_scanner(reg: ScannerRegistration):
    scanner.ip = reg.ip
    log.info("ESP32 Scanner registered with IP: %s", scanner.ip)
    return {"success": True, "ip": scanner.ip}


@router.post("/api/scan/trigger")
async def trigger_scan():
    if not scanner.ip:
        log.warning("Scan trigger failed: ESP32 IP not registered")
        raise HTTPException(status_code=400, detail="ESP32 Scanner IP not registered yet.")

    log.info("Triggering scan on ESP32 at %s...", scanner.ip)
    try:
        # Timeout is 15s since ESP32 blocks for 5s while scanning
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"http://{scanner.ip}/api/scan")
            resp.raise_for_status()

            # The ESP32 should return {"status": "complete", "devices_found": X}
            return resp.json()
    except Exception as e:
        log.error("Failed to trigger scan on ESP32: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to trigger scan: {e}")


@router.get("/api/devices")
async def get_devices():
    return await store.list_devices()


@router.get("/api/devices/ar")
async def get_ar_devices():
    ar_devices = []
    for summary in await store.list_ar_summaries():
        summary = dict(summary)
        summary.pop("problems", None)  # /api/devices/ar omits problems (unlike the WS feed)
        ar_devices.append(summary)
    return ar_devices


@router.get("/api/devices/{hostname}")
async def get_device(hostname: str):
    device = await store.get_device(hostname)

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    return device


@router.websocket("/ws/devices")
async def websocket_devices(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)

    try:
        await websocket.send_json({
            "event": "initial_devices",
            "devices": await store.list_ar_summaries()
        })

        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        if websocket in connected_clients:
            connected_clients.remove(websocket)
