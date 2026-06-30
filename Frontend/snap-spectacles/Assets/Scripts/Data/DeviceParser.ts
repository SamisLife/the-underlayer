/**
 * DeviceParser.ts
 * Pure data-normalization helpers extracted from DeviceListPanel.ts. Converts loosely-typed
 * backend / mock payloads into the strict Device shape and classifies device types. No scene,
 * UI, or networking concerns live here.
 *
 * The backend now emits the DeviceSummary field names directly (see DeviceTypes.ts), so this
 * is a defensive normalizer — it supplies defaults for mock/partial payloads. The legacy
 * fallbacks (e.g. threatLevel || severity) are kept only to tolerate older cached data.
 */

import {Device, ThreatLevel} from "./DeviceTypes"

export function normalizeThreatLevel(value: unknown): ThreatLevel {
  switch (String(value || "").toLowerCase()) {
    case "critical": return "critical"
    case "high": return "high"
    case "medium": return "medium"
    case "low": return "low"
    default: return "unknown"
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && isFinite(value) ? value : fallback
}

export function normalizeDevice(input: Device | Record<string, any>): Device {
  const source = input as Record<string, any>
  const summary = (source.ar_summary || source.arSummary || source) as Record<string, any>
  const deviceId = String(source.deviceId || summary.deviceId || source.hostname || "UNKNOWN")
  const hostname = String(source.hostname || summary.hostname || deviceId)

  const rawFindings = Array.isArray(summary.findings) ? summary.findings : []
  const vulnerabilityMatches = Array.isArray(summary.vulnerabilityMatches) ? summary.vulnerabilityMatches : []

  const packageNames = new Set<string>()
  vulnerabilityMatches.forEach((match: Record<string, any>) => {
    if (match.package) packageNames.add(String(match.package))
  })

  const inferredCveCount = vulnerabilityMatches.length > 0
    ? vulnerabilityMatches.length
    : rawFindings.reduce((total, finding) => total + numberOr(finding.cve_count, 0), 0)

  const threatLevel = normalizeThreatLevel(summary.threatLevel || summary.severity)

  return {
    deviceId,
    hostname,
    deviceType: source.deviceType || summary.deviceType,
    bt_name: source.bt_name || summary.bt_name || null,
    ip: String(source.ip || summary.ip || hostname),
    lastSeen: source.lastSeen || source.updatedAt,
    ar_summary: {
      hostname,
      deviceType: source.deviceType || summary.deviceType,
      ip: String(summary.ip || source.ip || hostname),
      scannedAt: summary.scannedAt,
      os: String(summary.os || "Unknown"),
      kernel: summary.kernel,
      hardware: {
        cpu: String(summary.hardware?.cpu || "Unknown"),
        cores: numberOr(summary.hardware?.cores, 0),
        ram_gb: numberOr(summary.hardware?.ram_gb, 0)
      },
      users: Array.isArray(summary.users) ? summary.users.map((u: any) => String(u)) : [],
      openPorts: Array.isArray(summary.openPorts) ? summary.openPorts : [],
      summary: String(summary.summary || `${hostname} - ${threatLevel} risk`),
      threatLevel,
      cveCount: numberOr(summary.cveCount, inferredCveCount),
      criticalCount: numberOr(summary.criticalCount, 0),
      highCount: numberOr(summary.highCount, 0),
      mediumCount: numberOr(summary.mediumCount, 0),
      packageCount: packageNames.size,
      findings: rawFindings,
      sourceCounts: summary.sourceCounts || {},
      vulnerabilityMatches,
      scanMetadata: summary.scanMetadata || {},
      arCard: summary.arCard,
      problems: summary.problems || []
    }
  }
}

export function guessDeviceType(device: Device): "phone" | "laptop" | "router" {
  // Directly use the classified device_type from the backend (via hosts.json -> Relay)
  const typeStr = String((device as any).deviceType || (device.ar_summary as any)?.deviceType || "").toLowerCase()

  if (typeStr === "phone" || typeStr === "mobile" || typeStr === "ios" || typeStr === "android") return "phone"
  if (typeStr === "router" || typeStr === "gateway" || typeStr === "ap") return "router"
  if (typeStr === "laptop" || typeStr === "pc" || typeStr === "desktop" || typeStr === "mac") return "laptop"

  // Fallback heuristic if device_type wasn't mapped
  const os = (device.ar_summary?.os || "").toLowerCase()
  const name = (device.bt_name || device.hostname || "").toLowerCase()

  if (os.includes("ios") || os.includes("android") || name.includes("phone") || name.includes("iphone")) return "phone"
  if (name.includes("router") || name.includes("gateway") || name.includes("ap")) return "router"
  if (name.includes("mac") || name.includes("pc") || name.includes("laptop")) return "laptop"

  return "laptop"
}
