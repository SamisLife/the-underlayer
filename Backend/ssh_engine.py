"""
The Underlayer — SSH Engine
Receives Bluetooth scan data from the ESP32, classifies devices against
known_devices.json, SSH-scans identified computers, and POSTs structured
results to relay.py's /api/scan endpoint.

Run: uvicorn ssh_engine:app --host 0.0.0.0 --port 8001 --reload
"""

import json
import logging
import logging.handlers
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import paramiko
import requests
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel, Field

load_dotenv()

# ── Configuration ─────────────────────────────────────────────────────────────

RELAY_URL = os.getenv("RELAY_URL", "http://localhost:8000")
SSH_PORT  = int(os.getenv("SSH_PORT", "22"))
SSH_TIMEOUT    = int(os.getenv("SSH_TIMEOUT", "10"))
CMD_TIMEOUT    = int(os.getenv("CMD_TIMEOUT", "15"))
ENGINE_VERSION = "1.0.0"

HERE      = Path(__file__).parent
DATA_DIR  = HERE / "data"
LOG_DIR   = HERE / "logs"
SCAN_DIR  = LOG_DIR / "scans"

LOG_DIR.mkdir(exist_ok=True)
SCAN_DIR.mkdir(exist_ok=True)

# Console + rotating file handler (5 MB × 3 backups)
_fmt     = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s — %(message)s")
_console = logging.StreamHandler()
_console.setFormatter(_fmt)
_file    = logging.handlers.RotatingFileHandler(
    LOG_DIR / "ssh_engine.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8"
)
_file.setFormatter(_fmt)

logging.basicConfig(level=logging.INFO, handlers=[_console, _file])
log = logging.getLogger("ssh_engine")

# ── Static data ───────────────────────────────────────────────────────────────

def _load_json(filename: str) -> Any:
    p = DATA_DIR / filename
    if p.exists():
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    log.warning("Missing data file: %s", filename)
    return None


HOSTS: List[Dict] = _load_json("hosts.json") or []
COMMANDS:      Dict       = (_load_json("ssh_commands.json") or {}).get("commands", {})

WELL_KNOWN_PORTS: Dict[int, str] = {
    21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
    80: "http", 110: "pop3", 143: "imap", 443: "https",
    3000: "node", 3306: "mysql", 5432: "postgresql",
    6379: "redis", 8080: "http-alt", 8443: "https-alt",
    9200: "elasticsearch", 27017: "mongodb", 5984: "couchdb",
}

# ── Pydantic models ───────────────────────────────────────────────────────────

class BluetoothDevice(BaseModel):
    name:         Optional[str] = None
    mac:          Optional[str] = None
    rssi:         Optional[int] = None
    device_class: Optional[int] = None


class BluetoothScanPayload(BaseModel):
    scanner_id: str = "specter-01"
    timestamp:  Optional[str] = None
    devices:    List[BluetoothDevice] = Field(default_factory=list)


class MatchedDevice(BaseModel):
    bt_name:      Optional[str]   = None
    bt_mac:       Optional[str]   = None
    rssi:         Optional[int]   = None
    device_type:  str             = "unknown"
    vendor:       Optional[str]   = None
    os_hint:      Optional[str]   = None
    ssh_capable:  bool            = False
    hostname:     Optional[str]   = None
    ssh_port:     int             = 22
    ssh_user:     Optional[str]   = None
    ssh_password: Optional[str]   = None
    network_password: Optional[str] = None
    ssh_key_path: Optional[str]   = None
    distance_m:   Optional[float] = None

# ── Device classification ─────────────────────────────────────────────────────

def estimate_distance(rssi: Optional[int]) -> Optional[float]:
    if rssi is None:
        return None
    # Free-space path loss: d = 10^((RSSI_ref - RSSI) / (10 * n))
    return round(10 ** ((-65 - rssi) / 20.0), 2)


def _lookup_host(bt: BluetoothDevice) -> Optional[Dict]:
    """Match a BT/Wi-Fi device against hosts.json — MAC exact match takes priority, then name substring."""
    name_lower = (bt.name or "").lower()
    mac_upper  = (bt.mac  or "").upper().replace("-", ":")

    for host in HOSTS:
        if host.get("bt_mac") and host["bt_mac"].upper() == mac_upper:
            return host
            
        if host.get("device_type") == "router":
            if host.get("network_name") and host["network_name"].lower() in name_lower:
                return host
        else:
            if host.get("bt_name") and host["bt_name"].lower() in name_lower:
                return host
    return None


def build_matched_device(bt: BluetoothDevice) -> Optional[MatchedDevice]:
    host = _lookup_host(bt)
    if not host:
        return None

    return MatchedDevice(
        bt_name          = bt.name,
        bt_mac           = bt.mac,
        rssi             = bt.rssi,
        device_type      = host.get("device_type", "unknown"),
        ssh_capable      = host.get("can_ssh", False),
        hostname         = host.get("hostname"),
        ssh_port         = host.get("ssh_port", SSH_PORT),
        ssh_user         = host.get("ssh_user"),
        ssh_password     = host.get("ssh_password"),
        network_password = host.get("network_password"),
        ssh_key_path     = host.get("ssh_key_path"),
        distance_m       = estimate_distance(bt.rssi),
    )

# ── SSH Scanner ───────────────────────────────────────────────────────────────

class SSHScanner:
    def __init__(self, host: str, port: int, username: str,
                 password: str = "", key_path: str = ""):
        self.host     = host
        self.port     = port
        self.username = username
        self.password = password
        self.key_path = key_path
        self._client: Optional[paramiko.SSHClient] = None

    def connect(self) -> bool:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        kwargs: Dict[str, Any] = dict(
            hostname     = self.host,
            port         = self.port,
            username     = self.username,
            timeout      = SSH_TIMEOUT,
            look_for_keys = False,
            allow_agent   = False,
        )
        resolved_key = Path(self.key_path).expanduser() if self.key_path else None
        if resolved_key and resolved_key.exists():
            kwargs["key_filename"]  = str(resolved_key)
        elif self.password:
            kwargs["password"] = self.password
        else:
            kwargs["look_for_keys"] = True
            kwargs["allow_agent"]   = True

        try:
            client.connect(**kwargs)
            self._client = client
            log.info("SSH connected  %s@%s:%d", self.username, self.host, self.port)
            return True
        except Exception as exc:
            log.error("SSH connect failed %s: %s", self.host, exc)
            return False

    def run(self, cmd: str, timeout: int = CMD_TIMEOUT) -> str:
        if not self._client:
            return ""
        try:
            _, stdout, stderr = self._client.exec_command(cmd, timeout=timeout)
            stdout.channel.settimeout(timeout)
            out = stdout.read().decode("utf-8", errors="replace").strip()
            err = stderr.read().decode("utf-8", errors="replace").strip()
            if err and not out:
                return err
            elif err and out:
                return f"{out}\n{err}"
            return out
        except Exception as exc:
            log.debug("Command failed [%.60s]: %s", cmd, exc)
            return f"Error/Timeout: {exc}"

    def close(self):
        if self._client:
            self._client.close()
            self._client = None

    def collect(self) -> Dict[str, str]:
        raw: Dict[str, str] = {}
        for key, cmd in COMMANDS.items():
            log.debug("  cmd: %s", key)
            raw[key] = self.run(cmd)
        return raw

# ── Output parsers ────────────────────────────────────────────────────────────

def _parse_os_release(text: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for line in text.splitlines():
        m = re.match(r'^(\w+)=["\']?([^"\']*)["\']?$', line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def parse_os(raw: Dict[str, str]) -> Dict:
    rel = _parse_os_release(raw.get("os_release", ""))
    return {
        "name":         rel.get("NAME"),
        "version":      rel.get("VERSION") or rel.get("VERSION_ID"),
        "pretty_name":  rel.get("PRETTY_NAME"),
        "kernel":       raw.get("kernel") or None,
        "architecture": raw.get("arch")   or None,
    }


def parse_hardware(raw: Dict[str, str]) -> Dict:
    cpu_line  = raw.get("cpu_info", "")
    cpu_model = cpu_line.split(":", 1)[1].strip() if ":" in cpu_line else None

    cores_s = raw.get("cpu_cores", "").strip()
    mem_s   = raw.get("memory_mb", "").strip()

    return {
        "cpu_model": cpu_model or None,
        "cpu_cores": int(cores_s) if cores_s.isdigit() else None,
        "memory_mb": int(mem_s)   if mem_s.isdigit()   else None,
    }


def parse_users(raw: Dict[str, str]) -> List[Dict]:
    seen: set  = set()
    users: List[Dict] = []
    for line in raw.get("users", "").splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1].isdigit():
            name = parts[0]
            uid  = int(parts[1])
            if name not in seen and (uid == 0 or 1000 <= uid <= 60000):
                seen.add(name)
                users.append({"username": name, "uid": uid})
    return users


def _extract_version(text: str) -> Optional[str]:
    if not text:
        return None
    m = re.search(r"(\d+[\d.]+[\w.\-]*)", text)
    return m.group(1) if m else (text.splitlines()[0][:80] if text else None)


def parse_apt_packages(raw: Dict[str, str]) -> List[Dict]:
    pkgs: List[Dict] = []
    for line in raw.get("apt_packages", "").splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2:
            pkgs.append({"name": parts[0], "version": parts[1]})
    return pkgs


def parse_python(raw: Dict[str, str]) -> Optional[Dict]:
    version = _extract_version(raw.get("python_version", ""))
    pkgs: List[Dict] = []
    try:
        pkgs = [
            {"name": p["name"], "version": p.get("version", "")}
            for p in json.loads(raw.get("python_packages", "[]"))
            if p.get("name")
        ]
    except Exception:
        pass
    return {"version": version, "packages": pkgs} if (version or pkgs) else None


def parse_nodejs(raw: Dict[str, str]) -> Optional[Dict]:
    ver_s   = raw.get("node_version", "").strip().lstrip("v")
    version = ver_s if re.match(r"\d+\.\d+", ver_s) else None
    pkgs: List[Dict] = []
    try:
        npm = json.loads(raw.get("node_packages", "{}"))
        for name, info in (npm.get("dependencies") or {}).items():
            pkgs.append({"name": name, "version": info.get("version", "")})
    except Exception:
        pass
    return {"version": version, "packages": pkgs} if (version or pkgs) else None


def parse_docker(raw: Dict[str, str]) -> Optional[Dict]:
    version_line = raw.get("docker_version", "").strip()
    if not version_line:
        return None

    images: List[Dict] = []
    for line in raw.get("docker_images", "").splitlines():
        parts = line.split("\t", 1)
        if parts[0]:
            images.append({"name": parts[0], "tag": parts[1] if len(parts) > 1 else None})

    containers: List[Dict] = []
    for line in raw.get("docker_containers", "").splitlines():
        parts = line.split("\t", 2)
        if parts[0]:
            containers.append({
                "name":   parts[0],
                "image":  parts[1] if len(parts) > 1 else None,
                "status": parts[2] if len(parts) > 2 else None,
            })

    return {
        "version":    _extract_version(version_line),
        "images":     images,
        "containers": containers,
    }


def parse_services(raw: Dict[str, str]) -> List[Dict]:
    seen: set      = set()
    services: List[Dict] = []
    for line in raw.get("services", "").splitlines():
        name = line.strip().removesuffix(".service")
        if name and name not in seen:
            seen.add(name)
            services.append({"name": name, "status": "running"})
    return services


def parse_open_ports(raw: Dict[str, str]) -> List[Dict]:
    ports: Dict[int, Dict] = {}
    for line in raw.get("open_ports", "").splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        m = re.search(r":(\d+)$", parts[3])
        if not m:
            continue
        port = int(m.group(1))
        if port in ports:
            continue
        proc: Optional[str] = None
        if len(parts) > 4:
            pm = re.search(r'"([^"]+)"', parts[-1])
            if pm:
                proc = pm.group(1)
        ports[port] = {
            "port":     port,
            "protocol": "tcp",
            "service":  proc or WELL_KNOWN_PORTS.get(port),
        }
    return sorted(ports.values(), key=lambda x: x["port"])


def parse_web_servers(raw: Dict[str, str]) -> Dict:
    result: Dict[str, Any] = {"nginx": None, "apache": None}

    ng = raw.get("nginx_version", "")
    if ng and "nginx" in ng.lower():
        result["nginx"] = {"version": _extract_version(ng)}

    ap = raw.get("apache_version", "")
    if ap and ("apache" in ap.lower() or "httpd" in ap.lower()):
        result["apache"] = {"version": _extract_version(ap)}

    return result


def parse_databases(raw: Dict[str, str]) -> List[Dict]:
    checks = [
        ("postgresql_ver", "postgresql"),
        ("mysql_ver",      "mysql"),
        ("mongodb_ver",    "mongodb"),
        ("redis_ver",      "redis"),
    ]
    dbs: List[Dict] = []
    for key, db_type in checks:
        val = raw.get(key, "").strip()
        if val and "not installed" not in val.lower():
            dbs.append({"type": db_type, "version": _extract_version(val)})
    return dbs


def parse_suid(raw: Dict[str, str]) -> List[str]:
    return [ln.strip() for ln in raw.get("suid_binaries", "").splitlines() if ln.strip()]


def parse_security_updates(raw: Dict[str, str]) -> Dict:
    total = sec = 0
    for line in raw.get("apt_upgradable", "").splitlines():
        if not line.strip():
            continue
        total += 1
        if "-security" in line or "/security" in line:
            sec += 1
    return {"upgradable_packages": total, "security_updates_available": sec}


def parse_kubernetes(raw: Dict[str, str]) -> Dict:
    k8s = raw.get("k8s_version", "").strip()
    return {"enabled": bool(k8s and "not installed" not in k8s.lower())}


def parse_environment(raw: Dict[str, str]) -> Dict:
    cloud: Optional[str] = None
    if raw.get("cloud_aws", "").strip().endswith("aws"):
        cloud = "AWS"
    elif raw.get("cloud_gcp", "").strip().endswith("gcp"):
        cloud = "GCP"
    elif raw.get("cloud_azure", "").strip().endswith("azure"):
        cloud = "Azure"

    virt = raw.get("virt_detect", "").strip()
    virtualized: Optional[bool] = None
    if virt == "none":
        virtualized = False
    elif virt and virt != "unknown":
        virtualized = True

    return {"cloud_provider": cloud, "virtualized": virtualized}


def build_scan_document(
    raw:         Dict[str, str],
    matched:     MatchedDevice,
    scan_start:  str,
) -> Dict[str, Any]:
    hostname = (
        matched.hostname
        or matched.bt_name
        or matched.bt_mac
        or "unknown"
    )
    return {
        "hostname":         hostname,
        "device_id":        matched.bt_mac or matched.bt_name or matched.hostname,
        "mac":              matched.bt_mac,
        "ip":               matched.hostname,
        "bt_name":          matched.bt_name,
        "device_type":      matched.device_type,
        "vendor":           matched.vendor,
        "position": {
            "distance_m": matched.distance_m,
            "rssi":       float(matched.rssi) if matched.rssi is not None else None,
        } if matched.rssi is not None else None,
        "os":               parse_os(raw),
        "hardware":         parse_hardware(raw),
        "users":            parse_users(raw),
        "sudo":             {"version": _extract_version(raw.get("sudo_version", ""))},
        "ssh":              {"version": _extract_version(raw.get("ssh_version", ""))},
        "apt_packages":     parse_apt_packages(raw),
        "python":           parse_python(raw),
        "nodejs":           parse_nodejs(raw),
        "java":             {"version": _extract_version(raw.get("java_version", ""))},
        "docker":           parse_docker(raw),
        "services":         parse_services(raw),
        "network":          {"open_ports": parse_open_ports(raw)},
        "web_servers":      parse_web_servers(raw),
        "databases":        parse_databases(raw),
        "suid_binaries":    parse_suid(raw),
        "security_updates": parse_security_updates(raw),
        "kubernetes":       parse_kubernetes(raw),
        "environment":      parse_environment(raw),
        "scan_metadata": {
            "scan_time":         scan_start,
            "collector_version": ENGINE_VERSION,
        },
        # Extra fields stored via DeviceScan's extra="allow"
        "device_type": matched.device_type,
        "vendor":      matched.vendor,
        "os_hint":     matched.os_hint,
        "bt_name":     matched.bt_name,
    }

# ── Relay submission ──────────────────────────────────────────────────────────

def post_to_relay(scan_doc: Dict[str, Any]) -> bool:
    url = f"{RELAY_URL}/api/scan"
    try:
        resp = requests.post(url, json=scan_doc, timeout=15)
        resp.raise_for_status()
        log.info("Relay ✓  %s  (scanId=%s)",
                 scan_doc.get("hostname"), resp.json().get("scanId"))
        return True
    except Exception as exc:
        log.error("Relay ✗  %s: %s", scan_doc.get("hostname"), exc)
        return False

# ── Scan log writer ───────────────────────────────────────────────────────────

def save_scan_log(doc: Dict[str, Any]) -> Path:
    """Write the scan document to logs/scans/<hostname>_<timestamp>.json."""
    host  = re.sub(r"[^\w.\-]", "_", doc.get("hostname") or "unknown")
    ts    = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    path  = SCAN_DIR / f"{host}_{ts}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, default=str)
    log.info("Scan log saved  %s", path)
    return path

# ── Full SSH scan pipeline ────────────────────────────────────────────────────

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

# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title="The Underlayer — SSH Engine", version=ENGINE_VERSION)


@app.get("/")
def root():
    return {"service": "SSH Engine", "version": ENGINE_VERSION, "relay": RELAY_URL}


@app.get("/api/health")
def health():
    return {
        "status":                "ok",
        "relay_url":             RELAY_URL,
        "registered_hosts":      len(HOSTS),
        "ssh_commands_loaded":   len(COMMANDS),
    }


@app.post("/api/bluetooth/scan")
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

    # Clear previous scan results in the relay database
    try:
        requests.delete(f"{RELAY_URL}/api/devices", timeout=5)
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


class DirectScanRequest(BaseModel):
    hostname:     str
    port:         int             = 22
    username:     Optional[str]   = None
    password:     Optional[str]   = None
    key_path:     Optional[str]   = None
    forward_to_relay: bool        = False


class RunCommandRequest(BaseModel):
    hostname: str
    command: str



@app.post("/api/debug/scan-host")
def debug_scan_host(req: DirectScanRequest):
    """
    Synchronous test endpoint — SSH into a host directly and return the raw
    scan JSON. Does NOT require a BT scan or hosts.json entry.
    Set forward_to_relay=true to also POST the result to relay.

    curl example:
      curl -s -X POST http://localhost:8001/api/debug/scan-host \\
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


@app.post("/api/ssh/run-command")
def run_command(req: RunCommandRequest):
    """
    Run an arbitrary command on the target host via SSH.
    It looks up the credentials from hosts.json via the hostname.
    """
    bt_mock = BluetoothDevice(name=req.hostname, mac=req.hostname)
    matched = build_matched_device(bt_mock)
    
    if not matched:
        # Fallback to direct hostname match if bt_mock fails
        for h in HOSTS:
            if h.get("hostname") == req.hostname:
                matched = MatchedDevice(
                    hostname=h.get("hostname"),
                    ssh_port=h.get("ssh_port", SSH_PORT),
                    ssh_user=h.get("ssh_user"),
                    ssh_password=h.get("ssh_password"),
                    ssh_key_path=h.get("ssh_key_path"),
                )
                break
                
    if not matched:
        return {"ok": False, "error": f"Host '{req.hostname}' not found in hosts.json"}

    scanner = SSHScanner(
        host     = matched.hostname,
        port     = matched.ssh_port,
        username = matched.ssh_user     or "ubuntu",
        password = matched.ssh_password or "",
        key_path = matched.ssh_key_path or "",
    )

    if not scanner.connect():
        return {"ok": False, "error": "SSH connection failed"}

    try:
        cmd_to_run = req.command
        # If using sudo and a password is known, inject it via stdin using -S
        if "sudo " in cmd_to_run and matched.ssh_password:
            # Replace 'sudo ' with 'echo "password" | sudo -S '
            cmd_to_run = cmd_to_run.replace("sudo ", f"echo '{matched.ssh_password}' | sudo -S ", 1)
            
        log.info("Executing remote command on %s: %s", req.hostname, cmd_to_run.replace(f"'{matched.ssh_password}'", "'***'"))
        
        stdout = scanner.run(cmd_to_run, timeout=30)
        
        if stdout:
            log.info("Command output:\n%s", stdout)
        else:
            log.info("Command completed with no output.")
            
        return {"ok": True, "stdout": stdout}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        scanner.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ssh_engine:app", host="0.0.0.0", port=8001, reload=True)
