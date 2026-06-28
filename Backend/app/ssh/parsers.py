"""Parsers that turn raw SSH command output into the structured scan document."""

import json
import re
from typing import Any, Dict, List, Optional

from ..config import ENGINE_VERSION
from ..models import MatchedDevice
from .classify import WELL_KNOWN_PORTS


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
    raw:        Dict[str, str],
    matched:    MatchedDevice,
    scan_start: str,
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
