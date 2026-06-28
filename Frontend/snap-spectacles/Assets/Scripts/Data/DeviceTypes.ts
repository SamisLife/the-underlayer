/**
 * DeviceTypes.ts
 * The canonical device contract. The backend's build_ar_summary (Backend/app/summary.py)
 * emits the DeviceSummary fields below 1:1 — same names (threatLevel, scannedAt, cveCount,
 * hardware, users, ...). Both the /api/devices/ar poll and the WebSocket device_updated
 * payload use this shape. DeviceParser.normalizeDevice only applies defensive defaults for
 * mock or partial payloads; it is no longer translating mismatched field names.
 */

export type ThreatLevel = "critical" | "high" | "medium" | "low" | "unknown"

export const DemoState = { isDemoMode: true }

export interface OpenPort {
  port: number
  service: string
  risk?: string
  note?: string
}

export interface Hardware {
  cpu: string
  cores: number
  ram_gb: number
}

export interface Finding {
  package: string
  cve_count: number
  severity: string
  source: string         // "python" | "apt" | "npm"
}

export interface VulnMatch {
  source: string
  package: string
  version: string
  cve: string
  ghsa?: string
  severity: string
  summary: string
  recommended_command: string | null
}

export interface ArCard {
  version: string
  header: {
    label: string
    subLabel: string
    threatLevel: ThreatLevel
    badge: string
    color: string
    pulse: boolean
  }
  stats: Array<{ key: string; value: string; sub: string }>
  sections: ArCardSection[]
  cta: { label: string; action: string; color: string }
  ui: { accentColor: string; pulse: boolean; defaultSection: string }
}

export interface ArCardSection {
  id: string
  label: string
  badge: string | null
  defaultExpanded: boolean
  locked?: boolean
  lockMessage?: string
  rows: Array<{ key: string; value: string; risk?: string; note?: string; severity?: string }>
}

// The ar_summary object sent from app.py's /api/devices/ar or WebSocket broadcast
export interface DeviceSummary {
  deviceId?: string
  hostname: string
  deviceType?: string
  ip: string
  scannedAt?: string
  os: string
  kernel?: string
  hardware: Hardware
  users: string[]
  openPorts: OpenPort[]
  summary: string           // e.g. "1458 CVEs across 81 packages — MEDIUM risk"
  threatLevel: ThreatLevel
  cveCount: number
  criticalCount: number
  highCount: number
  mediumCount: number
  packageCount: number
  findings: Finding[]                      // grouped: one per package
  sourceCounts?: Record<string, number>
  vulnerabilityMatches?: VulnMatch[]       // flat list (stripped of fix_version)
  scanMetadata?: Record<string, any>
  arCard?: ArCard
  problems?: Array<{
    priority: string
    description: string
    fixCommand: string
    fixLabel: string
  }>
}

// Top-level device object from /api/devices or WebSocket
export interface Device {
  deviceId: string
  hostname: string
  deviceType?: string
  bt_name: string | null
  ip?: string
  ar_summary: DeviceSummary
  lastSeen?: string
}

// WebSocket message shapes from app.py
export interface WsInitialDevices {
  type: "initial_devices"
  devices: Device[]
}

export interface WsDeviceUpdated {
  type: "device_updated"
  device: Device
}

export type WsMessage = WsInitialDevices | WsDeviceUpdated
