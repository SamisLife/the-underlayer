from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import os
import json
import logging
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("app")

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB", "underlayer")
DO_AI_API_KEY = os.getenv("DO_AI_API_KEY")
DO_AI_MODEL = os.getenv("DO_AI_MODEL", "openai-gpt-oss-120b")

if not MONGO_URI:
    raise RuntimeError("Missing MONGO_URI in .env")

mongo_client = AsyncIOMotorClient(MONGO_URI)
db = mongo_client[MONGO_DB]

app = FastAPI(title="The Underlayer Relay")

connected_clients: List[WebSocket] = []


class OSInfo(BaseModel):
    name: Optional[str] = None
    version: Optional[str] = None
    pretty_name: Optional[str] = None
    kernel: Optional[str] = None
    architecture: Optional[str] = None


class HardwareInfo(BaseModel):
    cpu_model: Optional[str] = None
    cpu_cores: Optional[int] = None
    memory_mb: Optional[int] = None


class UserInfo(BaseModel):
    username: str
    uid: int


class VersionInfo(BaseModel):
    version: Optional[str] = None


class PackageInfo(BaseModel):
    name: str
    version: Optional[str] = None


class PythonInfo(BaseModel):
    version: Optional[str] = None
    packages: List[PackageInfo] = Field(default_factory=list)


class NodeInfo(BaseModel):
    version: Optional[str] = None
    packages: List[PackageInfo] = Field(default_factory=list)


class DockerImage(BaseModel):
    name: str
    tag: Optional[str] = None


class DockerContainer(BaseModel):
    name: str
    image: str
    status: Optional[str] = None


class DockerInfo(BaseModel):
    version: Optional[str] = None
    images: List[DockerImage] = Field(default_factory=list)
    containers: List[DockerContainer] = Field(default_factory=list)


class ServiceInfo(BaseModel):
    name: str
    status: Optional[str] = None


class OpenPort(BaseModel):
    port: int
    protocol: Optional[str] = "tcp"
    service: Optional[str] = None


class NetworkInfo(BaseModel):
    open_ports: List[OpenPort] = Field(default_factory=list)


class NginxInfo(BaseModel):
    version: Optional[str] = None


class WebServersInfo(BaseModel):
    nginx: Optional[NginxInfo] = None
    apache: Optional[Any] = None


class DatabaseInfo(BaseModel):
    type: str
    version: Optional[str] = None


class SecurityUpdates(BaseModel):
    upgradable_packages: int = 0
    security_updates_available: int = 0


class KubernetesInfo(BaseModel):
    enabled: bool = False


class EnvironmentInfo(BaseModel):
    cloud_provider: Optional[str] = None
    virtualized: Optional[bool] = None


class ScanMetadata(BaseModel):
    scan_time: Optional[str] = None
    collector_version: Optional[str] = None


class DeviceScan(BaseModel):
    model_config = ConfigDict(extra="allow")

    device_id: Optional[str] = None
    mac: Optional[str] = None
    ip: Optional[str] = None
    position: Optional[Dict[str, float]] = None

    hostname: str
    os: Optional[OSInfo] = None
    hardware: Optional[HardwareInfo] = None
    users: List[UserInfo] = Field(default_factory=list)
    sudo: Optional[VersionInfo] = None
    ssh: Optional[VersionInfo] = None
    apt_packages: List[PackageInfo] = Field(default_factory=list)
    python: Optional[PythonInfo] = None
    nodejs: Optional[NodeInfo] = None
    java: Optional[VersionInfo] = None
    docker: Optional[DockerInfo] = None
    services: List[ServiceInfo] = Field(default_factory=list)
    network: Optional[NetworkInfo] = None
    web_servers: Optional[WebServersInfo] = None
    databases: List[DatabaseInfo] = Field(default_factory=list)
    suid_binaries: List[str] = Field(default_factory=list)
    security_updates: Optional[SecurityUpdates] = None
    kubernetes: Optional[KubernetesInfo] = None
    environment: Optional[EnvironmentInfo] = None
    scan_metadata: Optional[ScanMetadata] = None


class ApprovalRequest(BaseModel):
    hostname: str
    actionLabel: str
    command: str
    approved: bool


KNOWN_VULNERABILITIES = [
    {
        "type": "package",
        "name": "openssl",
        "affected_versions": ["3.0.2-0ubuntu1.12"],
        "cve": "CVE-DEMO-OPENSSL",
        "severity": "high",
        "fix": "sudo apt update && sudo apt install --only-upgrade openssl -y"
    },
    {
        "type": "python_package",
        "name": "flask",
        "affected_versions": ["2.2.5"],
        "cve": "CVE-DEMO-FLASK",
        "severity": "medium",
        "fix": "pip install --upgrade flask"
    },
    {
        "type": "open_port",
        "name": "postgresql",
        "port": 5432,
        "cve": "CONFIG-RISK-POSTGRES-EXPOSED",
        "severity": "medium",
        "fix": "sudo ufw deny 5432/tcp"
    }
]


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


def check_known_vulnerabilities(raw_scan: dict) -> List[Dict[str, Any]]:
    matches = []

    apt_packages = raw_scan.get("apt_packages") or []
    python_info = raw_scan.get("python") or {}
    python_packages = python_info.get("packages") or []
    network_info = raw_scan.get("network") or {}
    open_ports = network_info.get("open_ports") or []

    for vuln in KNOWN_VULNERABILITIES:
        if vuln["type"] == "package":
            for pkg in apt_packages:
                if pkg.get("name") == vuln["name"] and pkg.get("version") in vuln["affected_versions"]:
                    matches.append({
                        "source": "apt",
                        "package": pkg.get("name"),
                        "version": pkg.get("version"),
                        "cve": vuln["cve"],
                        "severity": vuln["severity"],
                        "recommended_command": vuln["fix"]
                    })

        if vuln["type"] == "python_package":
            for pkg in python_packages:
                if pkg.get("name") == vuln["name"] and pkg.get("version") in vuln["affected_versions"]:
                    matches.append({
                        "source": "python",
                        "package": pkg.get("name"),
                        "version": pkg.get("version"),
                        "cve": vuln["cve"],
                        "severity": vuln["severity"],
                        "recommended_command": vuln["fix"]
                    })

        if vuln["type"] == "open_port":
            for port in open_ports:
                if port.get("port") == vuln["port"]:
                    matches.append({
                        "source": "network",
                        "service": port.get("service"),
                        "port": port.get("port"),
                        "cve": vuln["cve"],
                        "severity": vuln["severity"],
                        "recommended_command": vuln["fix"]
                    })

    return matches


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
        "deviceType": "Linux Server",
        "position": scan.get("position"),
        "os": os_info.get("pretty_name") or os_info.get("version") or os_info.get("name"),
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
        "summary": f"{hostname} is a Linux server with {severity} risk.",
    }


def analyze_with_digitalocean_ai(
    raw_scan: dict,
    ar_summary: dict,
    vulnerability_matches: List[Dict[str, Any]]
) -> Dict[str, Any]:
    if not DO_AI_API_KEY:
        return {
            "enabled": False,
            "risk_summary": "AI analysis is not configured.",
            "recommendation": "Set DO_AI_API_KEY in .env.",
            "reasoning": [],
            "actions": []
        }

    url = "https://inference.do-ai.run/v1/chat/completions"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DO_AI_API_KEY}"
    }

    prompt = f"""
You are the AI security agent for The Underlayer, an AR cybersecurity assistant.

A sysadmin is looking at this device through Snap Spectacles.
Return short JSON only. No markdown.

AR device card:
{json.dumps(ar_summary, indent=2)}

Known vulnerability matches:
{json.dumps(vulnerability_matches, indent=2)}

Raw device scan:
{json.dumps(raw_scan, indent=2)}

Return exactly this JSON structure:
{{
  "risk_summary": "one short sentence",
  "recommendation": "one short sentence",
  "reasoning": [
    "short reason 1",
    "short reason 2"
  ],
  "actions": [
    {{
      "label": "human readable action",
      "command": "safe remediation command",
      "dangerLevel": "low|medium|high",
      "requiresApproval": true
    }}
  ]
}}

Rules:
- Keep all text short for AR glasses.
- Do not invent real CVEs.
- Prefer commands from known vulnerability matches.
- Do not use destructive commands such as rm -rf, shutdown, reboot, mkfs, userdel.
- Every action must require human approval.
"""

    payload = {
        "model": DO_AI_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 700
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        response.raise_for_status()

        result = response.json()
        content = result["choices"][0]["message"]["content"]

        try:
            parsed = json.loads(content)
            parsed["enabled"] = True
            return parsed
        except Exception:
            return {
                "enabled": True,
                "risk_summary": content,
                "recommendation": "Review AI response.",
                "reasoning": [],
                "actions": []
            }

    except Exception as e:
        return {
            "enabled": False,
            "risk_summary": "AI analysis failed.",
            "recommendation": "Use rule-based findings for now.",
            "reasoning": [str(e)],
            "actions": []
        }


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


def _log_scan_summary(scan_dict: Dict[str, Any], ar_summary: Dict[str, Any], scan_id: str) -> None:
    SEV_PAD = {"critical": "CRITICAL", "high": "HIGH", "medium": "MEDIUM", "low": "LOW"}

    hostname  = scan_dict.get("hostname", "?")
    bt_name   = scan_dict.get("bt_name") or ""
    os_info   = scan_dict.get("os") or {}
    hw_info   = scan_dict.get("hardware") or {}
    users     = scan_dict.get("users") or []
    network   = scan_dict.get("network") or {}
    ports     = network.get("open_ports") or []
    sec_upd   = scan_dict.get("security_updates") or {}
    severity  = ar_summary.get("severity", "unknown")
    findings  = ar_summary.get("findings") or []
    apt_pkgs  = scan_dict.get("apt_packages") or []
    services  = scan_dict.get("services") or []
    suid_bins = scan_dict.get("suid_binaries") or []
    docker    = scan_dict.get("docker") or {}
    python_i  = scan_dict.get("python") or {}
    node_i    = scan_dict.get("nodejs") or {}
    databases = scan_dict.get("databases") or []
    env_info  = scan_dict.get("environment") or {}
    vuln_hits = check_known_vulnerabilities(scan_dict)

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


@app.get("/")
async def root():
    return {
        "status": "running",
        "service": "The Underlayer Relay"
    }


@app.get("/api/health")
async def health():
    try:
        await db.command("ping")
        return {
            "status": "healthy",
            "mongodb": "connected"
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }


@app.post("/api/scan")
async def ingest_scan(scan: DeviceScan):
    try:
        log.info("Relay received  %s  (IP: %s  MAC: %s)", scan.hostname, scan.ip, scan.mac)
        scan_dict = scan.model_dump()
        now = datetime.now(timezone.utc)

        ar_summary = build_ar_summary(scan_dict)

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

        insert_result = await db.device_scans.insert_one(raw_doc)

        await db.devices.update_one(
            {"hostname": scan.hostname},
            {
                "$set": {
                    "hostname": scan.hostname,
                    "deviceId": scan.device_id or scan.hostname,
                    "mac": scan.mac,
                    "ip": scan.ip,
                    "updatedAt": now,
                    "latestScanId": str(insert_result.inserted_id),
                    "latestRawScan": scan_dict,
                    "arSummary": ar_summary,
                }
            },
            upsert=True,
        )

        await broadcast_device_update(ar_summary)

        _log_scan_summary(scan_dict, ar_summary, str(insert_result.inserted_id))

        return {
            "success": True,
            "scanId": str(insert_result.inserted_id),
            "arSummary": ar_summary,
        }
    except Exception:
        log.exception("ingest_scan failed for hostname=%s", scan.hostname)
        raise


@app.post("/api/analyze/{hostname}")
async def analyze_device(hostname: str):
    device = await db.devices.find_one({"hostname": hostname}, {"_id": 0})

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    raw_scan = device.get("latestRawScan") or {}
    ar_summary = device.get("arSummary") or {}

    vulnerability_matches = check_known_vulnerabilities(raw_scan)

    ai_analysis = analyze_with_digitalocean_ai(
        raw_scan=raw_scan,
        ar_summary=ar_summary,
        vulnerability_matches=vulnerability_matches
    )

    updated_ar_summary = {
        **ar_summary,
        "vulnerabilityMatches": vulnerability_matches,
        "aiSummary": ai_analysis.get("risk_summary"),
        "aiRecommendation": ai_analysis.get("recommendation"),
        "aiReasoning": ai_analysis.get("reasoning", []),
        "actions": ai_analysis.get("actions", [])
    }

    await db.devices.update_one(
        {"hostname": hostname},
        {
            "$set": {
                "vulnerabilityMatches": vulnerability_matches,
                "aiAnalysis": ai_analysis,
                "arSummary": updated_ar_summary,
                "analyzedAt": datetime.now(timezone.utc)
            }
        }
    )

    await broadcast_device_update(updated_ar_summary)

    return {
        "success": True,
        "hostname": hostname,
        "vulnerabilityMatches": vulnerability_matches,
        "aiAnalysis": ai_analysis,
        "arSummary": updated_ar_summary
    }


@app.post("/api/approve-action")
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

    result = await db.actions.insert_one(action_doc)

    await broadcast_event({
        "event": "action_recorded",
        "action": {
            "hostname": request.hostname,
            "actionLabel": request.actionLabel,
            "command": request.command,
            "approved": request.approved,
            "status": action_doc["status"]
        }
    })

    return {
        "success": True,
        "actionId": str(result.inserted_id),
        "status": action_doc["status"],
        "message": "Action recorded. SSH executor forwarding not connected yet."
    }


@app.get("/api/devices")
async def get_devices():
    devices = []

    cursor = db.devices.find({}, {"_id": 0})
    async for device in cursor:
        devices.append(device)

    return devices


@app.get("/api/devices/ar")
async def get_ar_devices():
    ar_devices = []

    cursor = db.devices.find({}, {"_id": 0, "arSummary": 1})
    async for device in cursor:
        if "arSummary" in device:
            ar_devices.append(device["arSummary"])

    return ar_devices


@app.get("/api/devices/{hostname}")
async def get_device(hostname: str):
    device = await db.devices.find_one({"hostname": hostname}, {"_id": 0})

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    return device


@app.websocket("/ws/devices")
async def websocket_devices(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)

    try:
        ar_devices = []

        cursor = db.devices.find({}, {"_id": 0, "arSummary": 1})
        async for device in cursor:
            if "arSummary" in device:
                ar_devices.append(device["arSummary"])

        await websocket.send_json({
            "event": "initial_devices",
            "devices": ar_devices
        })

        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        if websocket in connected_clients:
            connected_clients.remove(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )