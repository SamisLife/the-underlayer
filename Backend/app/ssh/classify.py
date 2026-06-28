"""Device classification: load known hosts + SSH command set, and match BLE/Wi-Fi
devices reported by SPECTER against hosts.json.
"""

import json
import logging
from typing import Any, Dict, List, Optional

from ..config import DATA_DIR, SSH_PORT
from ..models import BluetoothDevice, MatchedDevice

log = logging.getLogger("underlayer.ssh")


def _load_json(filename: str) -> Any:
    p = DATA_DIR / filename
    if p.exists():
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    log.warning("Missing data file: %s", filename)
    return None


HOSTS: List[Dict] = _load_json("hosts.json") or []
COMMANDS: Dict = (_load_json("ssh_commands.json") or {}).get("commands", {})

WELL_KNOWN_PORTS: Dict[int, str] = {
    21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
    80: "http", 110: "pop3", 143: "imap", 443: "https",
    3000: "node", 3306: "mysql", 5432: "postgresql",
    6379: "redis", 8080: "http-alt", 8443: "https-alt",
    9200: "elasticsearch", 27017: "mongodb", 5984: "couchdb",
}


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
