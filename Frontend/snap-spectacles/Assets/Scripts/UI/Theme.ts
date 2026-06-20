/**
 * Theme.ts
 * Shared holographic theme: colors, font sizes, threat color/label helpers, and the
 * active HUD font. Extracted verbatim from DeviceListPanel.ts so every panel shares one
 * source of truth and the DetailPanel <-> ListPanel import cycle is broken.
 */

import {ThreatLevel} from "../Data/DeviceTypes"

// Glowing holographic theme
export const C_CYAN = new vec4(0.0, 1.0, 0.85, 1.0)
export const C_CYAN_DIM = new vec4(0.0, 0.35, 0.3, 1.0)
export const C_WHITE = new vec4(0.95, 0.98, 1.0, 1.0)
export const C_DIM = new vec4(0.2, 0.3, 0.35, 1.0)
export const C_CRITICAL = new vec4(1.0, 0.05, 0.25, 1.0)
export const C_HIGH = new vec4(1.0, 0.4, 0.0, 1.0)
export const C_MEDIUM = new vec4(1.0, 0.75, 0.0, 1.0)
export const C_LOW = new vec4(0.1, 1.0, 0.5, 1.0)
export const C_UNKNOWN = new vec4(0.3, 0.4, 0.45, 1.0)
export const C_HOVER_BG = new vec4(0.0, 0.2, 0.3, 0.3)

export const FS_TITLE = 56
export const FS_BODY = 44
export const FS_SMALL = 36
export const FS_LABEL = 28
export const FS_TINY = 20

// Optional monospace font for all console labels. Set once by DeviceListPanel.init().
// Exposed via getter/setter so makeText (in a different module) always reads the current value.
let _activeHudFont: Font | undefined
export function getActiveHudFont(): Font | undefined {
  return _activeHudFont
}
export function setActiveHudFont(font: Font | undefined): void {
  _activeHudFont = font
}

export function threatColor(level: ThreatLevel): vec4 {
  switch (level) {
    case "critical": return C_CRITICAL
    case "high": return C_HIGH
    case "medium": return C_MEDIUM
    case "low": return C_LOW
    default: return C_UNKNOWN
  }
}

export function threatLabel(level: ThreatLevel): string {
  switch (level) {
    case "critical": return "CRITICAL"
    case "high": return "HIGH"
    case "medium": return "MEDIUM"
    case "low": return "LOW"
    default: return "UNRATED"
  }
}
