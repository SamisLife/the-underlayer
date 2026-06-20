/**
 * IDeviceDataSource.ts
 * The contract every consumer (panels) uses to fetch device data and run backend actions.
 * Demo vs live is hidden behind this interface; the panels never branch on demo mode.
 *
 * Result shapes intentionally mirror the original inline behavior so the UI can reproduce the
 * exact same text/state transitions (e.g. "ANALYSIS COMPLETE" vs "ANALYSIS FAILED" vs "ERROR").
 */

import {Device} from "../Data/DeviceTypes"

export interface ApproveActionRequest {
  hostname: string
  actionLabel: string
  command: string
}

/**
 * Outcome of an analyze() call. `device` is the updated device (or null when nothing changed);
 * `reason` is set only when ok is false. Kept as a flat interface (not a discriminated union)
 * because the Lens Studio TypeScript compiler does not reliably narrow unions on a boolean tag.
 */
export interface AnalyzeResult {
  ok: boolean
  device?: Device | null
  reason?: "failed" | "error"
}

/** Outcome of an approveAction() call. `reason` is set only when ok is false. */
export interface ActionResult {
  ok: boolean
  reason?: "failed" | "error"
}

export interface IDeviceDataSource {
  /** True when backed by the live HTTP backend, false in demo mode. */
  readonly isLive: boolean

  /** Fetch all devices. Rejects on network failure (callers keep their existing list). */
  getDevices(): Promise<Device[]>

  /** Trigger a backend scan. Resolves true on success, false on failure. */
  triggerScan(): Promise<boolean>

  /** Analyze a device; resolves an AnalyzeResult (never rejects). */
  analyze(device: Device): Promise<AnalyzeResult>

  /** Approve/execute a remediation action; resolves an ActionResult (never rejects). */
  approveAction(req: ApproveActionRequest): Promise<ActionResult>

  /** Fetch an AI explanation for a topic; resolves display text for every outcome. */
  learn(topic: string, context: string): Promise<string>
}
