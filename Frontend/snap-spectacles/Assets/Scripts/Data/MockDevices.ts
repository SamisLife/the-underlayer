/**
 * MockDevices.ts
 * Stand-in data while the WebSocket is not yet wired.
 * Data mirrors the actual Kali scan captured on 2026-06-10.
 * Swap this out with live WS data in DeviceListPanel.ts when ready.
 */

import {Device} from "./DeviceTypes"

export const MOCK_DEVICES: Device[] = [
  {
    deviceId: "10.0.0.131",
    hostname: "10.0.0.131",
    bt_name: "SAMI",
    ip: "10.0.0.131",
    lastSeen: "2026-06-10T01:54:48Z",
    ar_summary: {
      hostname: "10.0.0.131",
      ip: "10.0.0.131",
      scannedAt: "2026-06-10T01:54:48Z",
      os: "Kali GNU/Linux Rolling",
      kernel: "6.12.38-kali-amd64",
      hardware: {cpu: "Intel i5-7300U", cores: 4, ram_gb: 7.8},
      users: ["root", "sami"],
      openPorts: [
        {port: 22,    service: "ssh",      risk: "low",    note: "Encrypted remote access"},
        {port: 3000,  service: "node",     risk: "medium", note: "Node.js service exposed"},
        {port: 8080,  service: "http-alt", risk: "medium", note: "Unencrypted HTTP"},
        {port: 20241, service: "unknown",  risk: "medium", note: "Unidentified service"},
        {port: 39759, service: "unknown",  risk: "medium", note: "Unidentified service"},
      ],
      summary: "1458 CVEs across 81 packages — MEDIUM risk",
      threatLevel: "medium",
      cveCount: 1458,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 1458,
      packageCount: 81,
      findings: [
        {package: "chromium",  cve_count: 1000, severity: "medium", source: "apt"},
        {package: "binutils",  cve_count: 92,   severity: "medium", source: "apt"},
        {package: "apache2",   cve_count: 37,   severity: "medium", source: "apt"},
        {package: "Django",    cve_count: 37,   severity: "medium", source: "python"},
        {package: "curl",      cve_count: 32,   severity: "medium", source: "apt"},
        {package: "aiohttp",   cve_count: 21,   severity: "medium", source: "python"},
        {package: "Flask",     cve_count: 1,    severity: "medium", source: "python"},
      ],
    },
  },

  {
    deviceId: "10.0.0.1",
    hostname: "10.0.0.1",
    bt_name: "ROUTER",
    ip: "10.0.0.1",
    lastSeen: "2026-06-10T01:55:00Z",
    ar_summary: {
      hostname: "10.0.0.1",
      ip: "10.0.0.1",
      os: "OpenWRT 23.05",
      hardware: {cpu: "MT7622", cores: 2, ram_gb: 0.5},
      users: ["admin"],
      openPorts: [
        {port: 80,  service: "http",  risk: "medium", note: "Admin panel"},
        {port: 443, service: "https", risk: "low",    note: "Encrypted admin"},
      ],
      summary: "12 CVEs across 4 packages — LOW risk",
      threatLevel: "low",
      cveCount: 12,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 12,
      packageCount: 4,
      findings: [
        {package: "dnsmasq",  cve_count: 8, severity: "medium", source: "apt"},
        {package: "busybox",  cve_count: 4, severity: "low",    source: "apt"},
      ],
    },
  },

  {
    deviceId: "10.0.0.47",
    hostname: "10.0.0.47",
    bt_name: null,
    ip: "10.0.0.47",
    lastSeen: "2026-06-10T01:55:12Z",
    ar_summary: {
      hostname: "10.0.0.47",
      ip: "10.0.0.47",
      os: "Unknown",
      hardware: {cpu: "Unknown", cores: 0, ram_gb: 0},
      users: [],
      openPorts: [
        {port: 8883, service: "mqtt", risk: "high", note: "Unencrypted IoT broker"},
        {port: 5683, service: "coap", risk: "medium", note: "IoT protocol"},
      ],
      summary: "No scan data — UNKNOWN device",
      threatLevel: "unknown",
      cveCount: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      packageCount: 0,
      findings: [],
    },
  },
]
