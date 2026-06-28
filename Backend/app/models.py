"""Pydantic models for the unified backend.

Combines the relay's scan-ingest schema (DeviceScan and its nested types) with the
SSH engine's intake/request schemas (BluetoothScanPayload, MatchedDevice, ...).
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Relay: device scan schema ─────────────────────────────────────────────────

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
    ssh_status: Optional[str] = None


class DeviceScan(BaseModel):
    model_config = ConfigDict(extra="allow")

    device_id: Optional[str] = None
    device_type: Optional[str] = None
    mac: Optional[str] = None
    ip: Optional[str] = None
    bt_name: Optional[str] = None
    vendor: Optional[str] = None
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


# ── Relay: request bodies ─────────────────────────────────────────────────────

class ApprovalRequest(BaseModel):
    hostname: str
    actionLabel: str
    command: str
    approved: bool


class LearnRequest(BaseModel):
    topic: str
    context: Optional[str] = None


class ScannerRegistration(BaseModel):
    ip: str


# ── SSH engine: BLE intake + scan requests ────────────────────────────────────

class BluetoothDevice(BaseModel):
    name: Optional[str] = None
    mac: Optional[str] = None
    rssi: Optional[int] = None
    device_class: Optional[int] = None


class BluetoothScanPayload(BaseModel):
    scanner_id: str = "specter-01"
    timestamp: Optional[str] = None
    devices: List[BluetoothDevice] = Field(default_factory=list)


class MatchedDevice(BaseModel):
    bt_name: Optional[str] = None
    bt_mac: Optional[str] = None
    rssi: Optional[int] = None
    device_type: str = "unknown"
    vendor: Optional[str] = None
    os_hint: Optional[str] = None
    ssh_capable: bool = False
    hostname: Optional[str] = None
    ssh_port: int = 22
    ssh_user: Optional[str] = None
    ssh_password: Optional[str] = None
    network_password: Optional[str] = None
    ssh_key_path: Optional[str] = None
    distance_m: Optional[float] = None


class DirectScanRequest(BaseModel):
    hostname: str
    port: int = 22
    username: Optional[str] = None
    password: Optional[str] = None
    key_path: Optional[str] = None
    forward_to_relay: bool = False


class RunCommandRequest(BaseModel):
    hostname: str
    command: str
