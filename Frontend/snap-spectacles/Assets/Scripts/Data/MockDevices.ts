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
      sourceCounts: {
        "apt": 1161,
        "python": 297
      },
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
      sourceCounts: {
        "apt": 12
      },
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
      deviceType: "phone",
      ip: "10.0.0.47",
      os: "iOS 17.4",
      hardware: {cpu: "A16 Bionic", cores: 6, ram_gb: 6},
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

export const MOCK_PROBLEMS: Record<string, any[]> = {
  "10.0.0.131": [
    {
      priority: "high",
      description: "Exposed unencrypted HTTP service on port 8080.",
      fixCommand: "ufw deny 8080/tcp",
      fixLabel: "Block Port 8080"
    },
    {
      priority: "high",
      description: "Node.js service is running as root.",
      fixCommand: "killall node && su - sami -c 'node server.js'",
      fixLabel: "Demote Node"
    },
    {
      priority: "high",
      description: "Apache2 has 37 unpatched high-severity CVEs.",
      fixCommand: "apt-get install --only-upgrade apache2",
      fixLabel: "Patch Apache2"
    },
    {
      priority: "medium",
      description: "Unused avahi-daemon is exposing mDNS network info.",
      fixCommand: "systemctl disable avahi-daemon && systemctl stop avahi-daemon",
      fixLabel: "Disable Avahi"
    },
    {
      priority: "medium",
      description: "Outdated chromium package with 1000 known CVEs.",
      fixCommand: "apt-get install --only-upgrade chromium",
      fixLabel: "Upgrade Chromium"
    },
    {
      priority: "medium",
      description: "Outdated binutils package with 92 CVEs.",
      fixCommand: "apt-get install --only-upgrade binutils",
      fixLabel: "Upgrade Binutils"
    }
  ],
  "10.0.0.1": [
    {
      priority: "critical",
      description: "Router is using default administrative password.",
      fixCommand: "passwd root",
      fixLabel: "Change Password"
    },
    {
      priority: "medium",
      description: "Default admin panel exposed on port 80.",
      fixCommand: "uci set uhttpd.main.redirect_https='1' && uci commit uhttpd && /etc/init.d/uhttpd restart",
      fixLabel: "Force HTTPS"
    },
    {
      priority: "medium",
      description: "dnsmasq vulnerable to cache poisoning (8 CVEs).",
      fixCommand: "opkg update && opkg upgrade dnsmasq",
      fixLabel: "Patch Dnsmasq"
    },
    {
      priority: "low",
      description: "busybox contains minor privilege escalation flaws.",
      fixCommand: "opkg update && opkg upgrade busybox",
      fixLabel: "Upgrade Busybox"
    }
  ],
  "10.0.0.47": [
    {
      priority: "high",
      description: "Unencrypted MQTT broker running on port 8883.",
      fixCommand: "Disable MQTT service via iOS settings or MDM profile.",
      fixLabel: "Disable MQTT"
    }
  ]
}
