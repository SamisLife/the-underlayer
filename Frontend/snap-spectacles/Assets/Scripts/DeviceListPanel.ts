/**
 * The Underlayer device list - 3D Holographic Edition
 *
 * Spawns 3D device models (Laptops, Phones, Routers) inside a 
 * glowing outline menu, replacing the 2D flat rows.
 */

import {DragInteractorEvent} from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {lerp} from "SpectaclesInteractionKit.lspkg/Utils/mathUtils"
import NativeLogger from "SpectaclesInteractionKit.lspkg/Utils/NativeLogger"
import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import {RoundedRectangleVisual} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual"

import {Device, ThreatLevel, DeviceSummary, ArCard, DemoState} from "./Data/DeviceTypes"
import {MOCK_DEVICES} from "./Data/MockDevices"
import {DevicePlacer} from "./DevicePlacer"
import {DeviceDetailPanel} from "./DeviceDetailPanel"

const log = new NativeLogger("UnderlayerList3D")

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

// 3D Grid Dimensions
const PANEL_DISTANCE = -140.0
const PANEL_W = 66.0
const PANEL_H = 46.0
const COLUMNS = 3
const CELL_W = 20.0
const CELL_H = 24.0
const CELL_GAP_X = 2.0
const CELL_GAP_Y = 2.0
const CELL_STEP_X = CELL_W + CELL_GAP_X
const CELL_STEP_Y = CELL_H + CELL_GAP_Y
const GRID_START_X = -((COLUMNS - 1) * CELL_STEP_X) / 2.0
const GRID_START_Y = 4.0
const FADE_START_Y = 12.0
const FADE_END_Y = 16.0

export const FS_TITLE = 56
export const FS_BODY = 44
export const FS_SMALL = 36
export const FS_LABEL = 28
export const FS_TINY = 20

export let activeHudFont: Font | undefined

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

function normalizeThreatLevel(value: unknown): ThreatLevel {
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

function guessDeviceType(device: Device, index: number): "phone" | "laptop" | "router" {
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

export function makeObject(
  parent: SceneObject,
  layer: LayerSet,
  name: string,
  localPosition: vec3 = vec3.zero()
): SceneObject {
  const object = global.scene.createSceneObject(name)
  object.layer = layer
  object.setParent(parent)
  object.getTransform().setLocalPosition(localPosition)
  return object
}

export function makeText(
  parent: SceneObject,
  layer: LayerSet,
  name: string,
  content: string,
  size: number,
  color: vec4,
  localPosition: vec3,
  width: number,
  height: number,
  horizontalAlignment: HorizontalAlignment = HorizontalAlignment.Center,
  renderOrder: number = 30,
  wrap: boolean = false,
  verticalAlignment: VerticalAlignment = VerticalAlignment.Center
): Text {
  const object = makeObject(parent, layer, name, localPosition)
  const text = object.createComponent("Component.Text") as Text
  text.text = content
  text.size = size
  text.sizeToFit = false
  text.twoSided = true
  text.depthTest = false
  text.renderOrder = renderOrder
  text.worldSpaceRect = Rect.create(-width / 2, width / 2, -height / 2, height / 2)
  text.textFill.mode = TextFillMode.Solid
  text.textFill.color = color
  text.horizontalAlignment = horizontalAlignment
  text.verticalAlignment = verticalAlignment
  text.horizontalOverflow = wrap ? HorizontalOverflow.Wrap : HorizontalOverflow.Truncate
  text.verticalOverflow = VerticalOverflow.Truncate
  text.stretchMode = StretchMode.FitHeight
  if (activeHudFont) text.font = activeHudFont
  return text
}

export function makePlate(
  parent: SceneObject,
  layer: LayerSet,
  name: string,
  size: vec2,
  localPosition: vec3,
  color: vec4,
  renderOrder: number,
  borderColor?: vec4,
  borderSize: number = 0,
  cornerRadius: number = 0.02
): RoundedRectangle {
  const object = makeObject(parent, layer, name, localPosition)
  const plate = object.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
  plate.size = size
  plate.cornerRadius = cornerRadius
  plate.gradient = false
  plate.useTexture = false
  plate.backgroundColor = color
  plate.border = borderColor !== undefined
  if (borderColor) {
    plate.borderType = "Color"
    plate.borderColor = borderColor
    plate.borderSize = borderSize
  }
  plate.renderOrder = renderOrder
  plate.initialize()

  plate.gradient = false
  plate.useTexture = false
  plate.backgroundColor = color
  plate.border = borderColor !== undefined
  if (borderColor) {
    plate.borderType = "Color"
    plate.borderColor = borderColor
    plate.borderSize = borderSize
  }
  return plate
}

class Device3DView {
  private root: SceneObject
  private visualsRoot: SceneObject
  private button: RectangleButton
  private modelRoot: SceneObject
  private modelInstance: SceneObject | null = null
  private hoverInfoText: Text | null = null
  
  private totalDrag: number = 0
  private baseY: number = 0
  private currentAlpha: number = 1.0
  private isHovered: boolean = false

  private bgPlates: { plate: RoundedRectangle; baseColor: vec4; isBorder: boolean }[] = []
  private bgTexts: { textObj: Text; baseColor: vec4 }[] = []

  constructor(
    parent: SceneObject,
    private readonly layer: LayerSet,
    private readonly device: Device,
    private readonly index: number,
    prefab: ObjectPrefab | undefined,
    private readonly modelScale: number,
    private readonly modelOffsetY: number,
    private readonly modelOffsetZ: number,
    private readonly onPin: (device: Device) => void
  ) {
    const col = index % COLUMNS
    const row = Math.floor(index / COLUMNS)
    
    const posX = GRID_START_X + (col * CELL_STEP_X)
    this.baseY = GRID_START_Y - (row * CELL_STEP_Y)

    this.root = makeObject(parent, layer, `UL_Cell_${index}`, new vec3(posX, this.baseY, 0.8))
    this.visualsRoot = makeObject(this.root, layer, `UL_Cell_${index}_Vis`, vec3.zero())

    const level = device.ar_summary.threatLevel || "unknown"
    const accent = threatColor(level)
    
    // Interaction Collider
    const btnObj = makeObject(this.root, layer, `UL_Cell_${index}_Btn`, new vec3(0, 0, 2.0))
    this.button = btnObj.createComponent(RectangleButton.getTypeName()) as RectangleButton
    this.button.size = new vec3(CELL_W, CELL_H, 6.0) // Deep collider for 3D
    this.button.initialize()
    
    const visual = this.button.visual as RoundedRectangleVisual
    visual.shouldColorChange = false
    visual.baseDefaultColor = new vec4(0, 0, 0, 0)
    visual.baseHoveredColor = new vec4(0, 0, 0, 0)
    visual.baseTriggeredColor = new vec4(0, 0, 0, 0)
    visual.defaultHasBorder = false
    
    this.button.onTriggerUp.add(() => this.handleTrigger());
    this.button.onHoverEnter.add(() => this.handleHover(true));
    this.button.onHoverExit.add(() => this.handleHover(false));
    
    this.buildCell(accent, prefab)
  }

  private addPlate(plate: RoundedRectangle, color: vec4, isBorder = false): RoundedRectangle {
    this.bgPlates.push({ plate, baseColor: color, isBorder })
    return plate
  }

  private addText(textObj: Text, color: vec4): Text {
    this.bgTexts.push({ textObj, baseColor: color })
    return textObj
  }

  private handleTrigger(): void {
    this.onPin(this.device)
  }

  private handleHover(state: boolean): void {
    this.isHovered = state
    if (this.bgPlates.length > 0) {
      this.bgPlates[0].baseColor = state ? C_HOVER_BG : new vec4(0,0,0,0)
      this.updateVisualAlpha(this.currentAlpha)
    }
    if (this.hoverInfoText) {
      this.hoverInfoText.enabled = state
    }
  }

  private buildCell(accent: vec4, prefab: ObjectPrefab | undefined): void {
    const hostname = this.device.bt_name || this.device.hostname || "UNKNOWN"
    const ip = this.device.ar_summary?.ip || this.device.ip || this.device.hostname
    
    // Background highlight (invisible by default, shows on hover)
    const bg = makePlate(
      this.visualsRoot,
      this.layer,
      `UL_Cell_${this.index}_BG`,
      new vec2(CELL_W, CELL_H),
      vec3.zero(),
      new vec4(0,0,0,0),
      5,
      new vec4(accent.x, accent.y, accent.z, 0.4),
      0.1
    )
    this.addPlate(bg, new vec4(0,0,0,0))
    this.addPlate(bg, new vec4(accent.x, accent.y, accent.z, 0.4), true)

    // Data Labels below the 3D model
    this.addText(makeText(
      this.visualsRoot,
      this.layer,
      `UL_Cell_${this.index}_Name`,
      hostname.toUpperCase(),
      FS_SMALL,
      C_WHITE,
      new vec3(0, -CELL_H / 2 + 3.5, 0.2),
      CELL_W - 2.0,
      8.0
    ), C_WHITE)

    this.addText(makeText(
      this.visualsRoot,
      this.layer,
      `UL_Cell_${this.index}_IP`,
      ip,
      FS_LABEL,
      C_CYAN,
      new vec3(0, -CELL_H / 2 + 1.5, 0.2),
      CELL_W - 2.0,
      6.0
    ), C_CYAN)

    // Hover Information Text
    const osStr = this.device.ar_summary?.os || "UNKNOWN OS"
    const hw = this.device.ar_summary?.hardware
    const hwStr = hw ? `${hw.cpu} (${hw.cores}C / ${hw.ram_gb}GB)` : "UNKNOWN HW"
    const users = this.device.ar_summary?.users || []
    const usrStr = users.length > 0 ? users.join(", ") : "NO ACTIVE USERS"

    const hoverInfoStr = `OS: ${osStr}\nHW: ${hwStr}\nUSR: ${usrStr}`

    this.hoverInfoText = makeText(
      this.visualsRoot,
      this.layer,
      `UL_Cell_${this.index}_HoverInfo`,
      hoverInfoStr,
      FS_LABEL,
      C_LOW,
      new vec3(0, -CELL_H / 2 - 7.5, 0.2), // Push further down
      CELL_W + 20.0, // Wider
      22.0 // Taller to fit multiline
    )
    this.addText(this.hoverInfoText, C_LOW)
    this.hoverInfoText.enabled = false

    // 3D Model Instance
    this.modelRoot = makeObject(this.visualsRoot, this.layer, `UL_Cell_${this.index}_Model`, new vec3(0, this.modelOffsetY, this.modelOffsetZ))
    this.modelRoot.getTransform().setLocalScale(new vec3(this.modelScale, this.modelScale, this.modelScale))
    
    if (prefab) {
      this.modelInstance = prefab.instantiate(this.modelRoot)
      this.modelInstance.getTransform().setLocalPosition(vec3.zero())
    } else {
      // Fallback if prefab missing
      this.addText(makeText(
        this.modelRoot,
        this.layer,
        `UL_Cell_${this.index}_Fallback`,
        "[ MODEL OFFLINE ]",
        FS_LABEL,
        C_DIM,
        vec3.zero(),
        CELL_W,
        4.0
      ), C_DIM)
    }

    // Gentle rotation animation for the 3D model
    const script = this.root.createComponent("Component.ScriptComponent") as ScriptComponent
    const spinEvent = script.createEvent("UpdateEvent") as UpdateEvent
    let angle = 0
    spinEvent.bind(() => {
      const dt = getDeltaTime()
      angle += dt * (this.isHovered ? 1.5 : 0.4)
      if (this.modelInstance) {
        this.modelInstance.getTransform().setLocalRotation(quat.angleAxis(angle, vec3.up()))
      } else {
        this.modelRoot.getTransform().setLocalRotation(quat.angleAxis(angle, vec3.up()))
      }
    })
  }

  public updateGlobalAlpha(globalY: number): void {
    // Keep alpha at 1.0 since scrolling is removed
    this.currentAlpha = 1.0
    this.updateVisualAlpha(1.0)
  }

  private updateVisualAlpha(alpha: number): void {
    if (Math.abs(this.currentAlpha - alpha) < 0.01) return
    this.currentAlpha = alpha

    this.visualsRoot.enabled = alpha > 0.01
    this.button.enabled = alpha > 0.1 

    if (alpha > 0.01) {
      this.bgPlates.forEach(p => {
        const c = p.baseColor
        if (p.isBorder) p.plate.borderColor = new vec4(c.x, c.y, c.z, c.w * alpha)
        else p.plate.backgroundColor = new vec4(c.x, c.y, c.z, c.w * alpha)
      })
      this.bgTexts.forEach(t => {
        const c = t.baseColor
        t.textObj.textFill.color = new vec4(c.x, c.y, c.z, c.w * alpha)
      })
    }
  }

  public get baseYPosition(): number {
    return this.baseY
  }

  public destroy(): void {
    this.root.destroy()
  }
}

@component
export class DeviceListPanel extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint("Optional. Assign the Camera Object to copy its render layer.")
  cameraRoot: SceneObject

  @input
  @hint("URL for the WebSocket backend (e.g. ws://10.0.0.131:8000/ws/devices or wss://tunnel.cloudflare.com/ws/devices)")
  websocketUrl: string = "ws://10.0.0.131:8000/ws/devices"

  @input
  @allowUndefined
  @hint("Optional monospace font for all console labels.")
  hudFont: Font

  @input
  @allowUndefined
  @hint("Prefab for a Phone device (with hacker material)")
  phonePrefab: ObjectPrefab

  @input
  @allowUndefined
  @hint("Prefab for a Laptop device (with hacker material)")
  laptopPrefab: ObjectPrefab

  @input
  @allowUndefined
  @hint("Prefab for a Router device (with hacker material)")
  routerPrefab: ObjectPrefab

  @input
  @allowUndefined
  @hint("Prefab for the device indicator (e.g. 3D discord server mesh).")
  indicatorPrefab: ObjectPrefab

  @input
  @allowUndefined
  @hint("Prefab for the Triple Monitor 3D UI.")
  tripleMonitorPrefab: ObjectPrefab

  @input
  @hint("Scale multiplier for Center Monitor UI (default 0.2)")
  centerUIScale: number = 0.2
  @input
  @hint("Pos Offset for Center Monitor UI")
  centerUIOffset: vec3 = new vec3(0, 0, 0)
  @input
  @hint("Rot Offset for Center Monitor UI (Degrees)")
  centerUIRot: vec3 = new vec3(0, 0, 0)

  @input
  @hint("Scale multiplier for Left Monitor UI (default 0.2)")
  leftUIScale: number = 0.2
  @input
  @hint("Pos Offset for Left Monitor UI")
  leftUIOffset: vec3 = new vec3(0, 0, 0)
  @input
  @hint("Rot Offset for Left Monitor UI (Degrees)")
  leftUIRot: vec3 = new vec3(0, 0, 0)

  @input
  @hint("Scale multiplier for Right Monitor UI (default 0.2)")
  rightUIScale: number = 0.2
  @input
  @hint("Pos Offset for Right Monitor UI")
  rightUIOffset: vec3 = new vec3(0, 0, 0)
  @input
  @hint("Rot Offset for Right Monitor UI (Degrees)")
  rightUIRot: vec3 = new vec3(0, 0, 0)

  @input
  @hint("Scale multiplier for the indicator prefab")
  indicatorScale: number = 1.0

  @input
  @allowUndefined
  @hint("Sound when devices finish loading from API")
  loadedAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Sound when clicking a device card")
  selectAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Sound when device is anchored")
  anchorAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Sound when opening the device monitors")
  openAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Looping sound when analyzing")
  analyzeAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Optional material (like Hologram.mat) to apply to the indicator for a glowing effect.")
  indicatorMaterial: Material

  @input
  @hint("Scale multiplier to size the 3D models down to fit the cell")
  modelScale: number = 0.2

  @input
  @hint("Y-axis offset to center models vertically in their cell")
  modelOffsetY: number = 1.5

  @input
  @hint("Z-axis offset to push models forward out of the screen")
  modelOffsetZ: number = 4.0

  @input
  @allowUndefined
  shellTerminalPrefab?: ObjectPrefab

  @input
  @hint("Scale multiplier for the shell terminal (default 0.02)")
  shellTerminalScale: number = 0.02

  @input
  @hint("Local position offset for the shell terminal")
  shellTerminalOffset: vec3 = new vec3(-15.0, -8.0, 0.0)

  @input
  @allowUndefined
  notebookPrefab?: ObjectPrefab

  @input
  @hint("Scale multiplier for the notebook (default 0.16)")
  notebookScale: number = 0.16

  @input
  @hint("Local position offset for the notebook")
  notebookOffset: vec3 = new vec3(-15.0, -8.0, 0.0)

  @input
  @hint("Local position for notebook Title")
  notebookTitlePos: vec3 = new vec3(-3.5, 17.5, 2.0)

  @input
  @hint("Local position for notebook Body text")
  notebookTextPos: vec3 = new vec3(-4.0, -27.0, 2.0)

  @input
  @hint("Local position for notebook Close Button")
  notebookCloseBtnPos: vec3 = new vec3(-16.0, 17.5, 2.0)

  public onDeviceReadyToPin: ((device: Device) => void) | null = null

  private panelRoot: SceneObject
  private listRoot: SceneObject
  private headerRoot: SceneObject
  private layer: LayerSet
  private cells: Device3DView[] = []
  private devices: Device[] = []
  private initialized = false
  
  // Track active detail panels so placing a device again removes its previous instance
  private activeDetailPanels: Map<string, DeviceDetailPanel> = new Map()
  
  private countText: Text

  onAwake(): void {
    const delayedInit = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    delayedInit.bind(() => this.init())
    delayedInit.reset(0.15)
  }

  public loadDevices(devices: Device[]): void {
    this.devices = (devices || []).map((device) => normalizeDevice(device))
    if (this.initialized) {
      this.rebuildList()
    }
  }

  public handleWebSocketMessage(rawMessage: string): void {
    try {
      const payload = JSON.parse(rawMessage) as Record<string, any>
      const eventName = payload.type || payload.event

      if (eventName === "initial_devices" && Array.isArray(payload.devices)) {
        this.loadDevices(payload.devices as Device[])
        if (this.loadedAudio) {
          this.loadedAudio.play(1)
        }
        return
      }

      if (eventName === "device_updated" && payload.device) {
        const updatedDevice = normalizeDevice(payload.device)
        const updatedDevices = this.devices.slice()
        const existingIndex = updatedDevices.findIndex((d) => d.deviceId === updatedDevice.deviceId)
        if (existingIndex >= 0) updatedDevices[existingIndex] = updatedDevice
        else updatedDevices.push(updatedDevice)
        this.loadDevices(updatedDevices)
        
        // Find the matching panel by deviceId, hostname, or IP
        let targetDeviceId: string | null = null
        if (this.activeDetailPanels.has(updatedDevice.deviceId)) {
          targetDeviceId = updatedDevice.deviceId
        } else {
          for (const key of this.activeDetailPanels.keys()) {
            if (key === updatedDevice.hostname || key === updatedDevice.ip || key === updatedDevice.bt_name) {
              targetDeviceId = key
              break
            }
          }
        }

        // Push the update to the active AR detail panel if it's placed!
        if (targetDeviceId && this.activeDetailPanels.has(targetDeviceId)) {
          const oldPanel = this.activeDetailPanels.get(targetDeviceId)
          if (oldPanel) {
            try {
              let currentPos = vec3.zero()
              if (typeof (oldPanel as any).getWorldPosition === "function") {
                const pos = (oldPanel as any).getWorldPosition()
                currentPos = new vec3(pos.x, pos.y, pos.z)
              } else if ((oldPanel as any).panelRoot) {
                const pos = (oldPanel as any).panelRoot.getTransform().getWorldPosition()
                currentPos = new vec3(pos.x, pos.y, pos.z)
              }
              
              let wasExpanded = false
              if (typeof (oldPanel as any).isExpanded === "function") {
                wasExpanded = (oldPanel as any).isExpanded()
              }
              
              oldPanel.destroy()
              this.activeDetailPanels.delete(targetDeviceId)
            
            const apiUrlBase = this.websocketUrl.replace("ws://", "http://").replace("wss://", "https://").replace("/ws/devices", "")
            const newPanel = new DeviceDetailPanel(
              this.getSceneObject(),
              this.layer,
              this.cameraRoot,
              updatedDevice,
              currentPos,
              this.indicatorPrefab,
              this.indicatorScale,
              this.indicatorMaterial,
              this.tripleMonitorPrefab,
              this.centerUIScale,
              this.centerUIOffset,
              this.centerUIRot,
              this.leftUIScale,
              this.leftUIOffset,
              this.leftUIRot,
              this.rightUIScale,
              this.rightUIOffset,
              this.rightUIRot,
              apiUrlBase,
              this.shellTerminalPrefab,
              this.shellTerminalScale,
              this.shellTerminalOffset,
              this.notebookPrefab,
              this.notebookScale,
              this.notebookOffset,
              this.notebookTitlePos,
              this.notebookTextPos,
              this.notebookCloseBtnPos
            )
            
            // Keep it expanded if the old one was expanded
            if (wasExpanded && typeof (newPanel as any).setExpanded === "function") {
              (newPanel as any).setExpanded(true)
            }
            
            this.activeDetailPanels.set(targetDeviceId, newPanel)
            } catch (err) {
              log.e(`Failed to hot-swap AR panel: ${err}`)
            }
          }
        }
      }
    } catch (error) {
      log.e(`WebSocket parse error: ${error}`)
    }
  }

  private init(): void {
    if (this.initialized) return

    try {
      activeHudFont = this.hudFont
      this.layer = this.resolveLayer()
      this.panelRoot = makeObject(this.sceneObject, this.layer, "UL_HoloMenu", new vec3(0, 0, PANEL_DISTANCE))
      
      this.buildWireframeOutline()
      this.buildHeader()
      this.buildDataRain()
      
      this.listRoot = makeObject(this.panelRoot, this.layer, "UL_Grid", new vec3(0, 0, 0.6))

      this.initialized = true
      
      this.panelRoot.enabled = false // Start hidden
      
      log.d(`3D Holo Menu initialized`)
      
      // Connect to the backend
      this.connectWebSocket()

    } catch (error) {
      log.e(`HUD initialization failed: ${error}`)
    }
  }

  private connectWebSocket(): void {
    log.d(`WebSocket not supported natively. Data will be fetched on demand via HTTP.`)
    // Don't fetch on init, let the show() method trigger the fetch.
  }

  private internetModule: any = require("LensStudio:InternetModule")

  private fetchData(): void {
    const apiUrl = this.websocketUrl.replace("ws://", "http://").replace("wss://", "https://").replace("/ws/devices", "/api/devices/ar")
    log.d(`Fetching latest devices from ${apiUrl}`)
    this.pollDevices(apiUrl)
  }

  private pollDevices(apiUrl: string): void {
    if (DemoState.isDemoMode) {
      log.d(`[DEMO MODE] Loading mock devices list instantly...`)
      this.handleWebSocketMessage(JSON.stringify({ event: "initial_devices", devices: MOCK_DEVICES }))
      return
    }

    try {
      const request = RemoteServiceHttpRequest.create()
      request.url = apiUrl
      request.method = RemoteServiceHttpRequest.HttpRequestMethod.Get

      this.internetModule.performHttpRequest(request, (response: RemoteServiceHttpResponse) => {
        if (response.statusCode === 200) {
          try {
            const data = JSON.parse(response.body)
            if (Array.isArray(data)) {
              this.handleWebSocketMessage(JSON.stringify({ event: "initial_devices", devices: data }))
            } else {
              log.w(`API returned 200 but data is not an array: ${response.body}`)
            }
          } catch (e) {
            log.w(`Failed to parse HttpResponse body: ${e}. Body was: ${response.body}`)
          }
        } else {
          log.e(`Polling failed! Status: ${response.statusCode}. Please check Windows Firewall if status is 0!`)
        }
      })
    } catch (error) {
      log.e(`HTTP Polling catch block error: ${error}`)
    }
  }

  public triggerBackendScan(onComplete: (success: boolean) => void): void {
    if (DemoState.isDemoMode) {
      log.d(`[DEMO MODE] Simulating backend scan...`)
      const delay = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
      delay.bind(() => {
        onComplete(true)
      })
      delay.reset(3.0) // Simulate a realistic 3s scan time
      return
    }

    const apiUrl = this.websocketUrl.replace("ws://", "http://").replace("wss://", "https://").replace("/ws/devices", "/api/scan/trigger")
    log.d(`Sending scan trigger request to ${apiUrl}`)

    try {
      const request = RemoteServiceHttpRequest.create()
      request.url = apiUrl
      request.method = RemoteServiceHttpRequest.HttpRequestMethod.Post

      this.internetModule.performHttpRequest(request, (response: RemoteServiceHttpResponse) => {
        if (response.statusCode === 200) {
          log.d(`Scan complete! Backend response: ${response.body}`)
          const delayed = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
          delayed.bind(() => {
            if (this.loadedAudio) {
              this.loadedAudio.play(1)
            }
            onComplete(true)
          })
          delayed.reset(3.0)
        } else {
          log.e(`Scan trigger failed with status ${response.statusCode}. Body: ${response.body}`)
          onComplete(false)
        }
      })
    } catch (error) {
      log.e(`HTTP trigger catch block error: ${error}`)
      onComplete(false)
    }
  }

  private resolveLayer(): LayerSet {
    if (this.cameraRoot) {
      const camera = this.cameraRoot.getComponent("Component.Camera") as Camera
      if (camera) return camera.renderLayer
    }
    return this.sceneObject.layer
  }

  private buildWireframeOutline(): void {
    // Top border line
    makePlate(
      this.panelRoot, this.layer, "UL_BorderTop",
      new vec2(PANEL_W, 0.2), new vec3(0, PANEL_H / 2, 0),
      C_CYAN, 5
    )
    // Bottom border line
    makePlate(
      this.panelRoot, this.layer, "UL_BorderBottom",
      new vec2(PANEL_W, 0.2), new vec3(0, -PANEL_H / 2, 0),
      C_CYAN_DIM, 5
    )
    // Left border
    makePlate(
      this.panelRoot, this.layer, "UL_BorderLeft",
      new vec2(0.2, PANEL_H), new vec3(-PANEL_W / 2, 0, 0),
      C_CYAN_DIM, 5
    )
    // Right border
    makePlate(
      this.panelRoot, this.layer, "UL_BorderRight",
      new vec2(0.2, PANEL_H), new vec3(PANEL_W / 2, 0, 0),
      C_CYAN_DIM, 5
    )
    
    // Corners dots for technical feel
    const cornerSize = new vec2(1.0, 1.0)
    makePlate(this.panelRoot, this.layer, "C1", cornerSize, new vec3(-PANEL_W/2, PANEL_H/2, 0.1), C_CYAN, 6)
    makePlate(this.panelRoot, this.layer, "C2", cornerSize, new vec3(PANEL_W/2, PANEL_H/2, 0.1), C_CYAN, 6)
    makePlate(this.panelRoot, this.layer, "C3", cornerSize, new vec3(-PANEL_W/2, -PANEL_H/2, 0.1), C_CYAN_DIM, 6)
    makePlate(this.panelRoot, this.layer, "C4", cornerSize, new vec3(PANEL_W/2, -PANEL_H/2, 0.1), C_CYAN_DIM, 6)

    // Holographic Scanner Beam
    const beamPlate = makePlate(this.panelRoot, this.layer, "UL_ScanBeam", new vec2(PANEL_W, 0.4), new vec3(0, PANEL_H/2, 0.5), C_CYAN, 7)
    const beamObj = beamPlate.getSceneObject()
    const script = this.panelRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const beamEvent = script.createEvent("UpdateEvent") as UpdateEvent
    let beamY = PANEL_H / 2
    beamEvent.bind(() => {
      beamY -= getDeltaTime() * 20.0
      if (beamY < -PANEL_H / 2) beamY = PANEL_H / 2
      beamObj.getTransform().setLocalPosition(new vec3(0, beamY, 0.5))
    })
  }

  private buildHeader(): void {
    this.headerRoot = makeObject(this.panelRoot, this.layer, "UL_Header", new vec3(0, PANEL_H / 2 + 3.0, 0))
    
    makeText(
      this.headerRoot, this.layer, "UL_Title",
      "SPATIAL SCAN", FS_TITLE, C_WHITE,
      new vec3(-PANEL_W/2 + 8.0, 0, 0), 30.0, 10.0, HorizontalAlignment.Left
    )
    
    this.countText = makeText(
      this.headerRoot, this.layer, "UL_DeviceCount",
      "0 ENTITIES", FS_SMALL, C_CYAN,
      new vec3(PANEL_W/2 - 8.0, 0, 0), 20.0, 8.0, HorizontalAlignment.Right
    )
  }

  private buildDataRain(): void {
    const maxParticles = 40
    const particles: { text: Text, x: number, y: number, life: number, speed: number }[] = []
    
    // We attach the rain directly to the panelRoot so it spans the entire UI
    for (let i = 0; i < maxParticles; i++) {
      const pText = makeText(this.panelRoot, this.layer, `UL_Rain_${i}`, "", FS_TINY, C_CRITICAL, vec3.zero(), 10.0, 4.0)
      pText.enabled = false
      particles.push({ text: pText, x: 0, y: 0, life: 0, speed: 0 })
    }

    const script = this.panelRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const rainEvent = script.createEvent("UpdateEvent") as UpdateEvent
    rainEvent.bind(() => {
      const dt = getDeltaTime()
      
      // Randomly spawn multiple particles per frame for a heavy data rain effect
      if (Math.random() < 0.6) {
        const p = particles.find(pt => pt.life <= 0)
        if (p) {
          p.life = 2.0 + Math.random() * 3.0
          p.speed = 6.0 + Math.random() * 8.0
          // Spread randomly across the width of the panel
          p.x = (Math.random() - 0.5) * PANEL_W
          // Start at the bottom of the panel
          p.y = -PANEL_H / 2 - 2.0
          // Random Z depth so they float in front and behind models
          const zDepth = (Math.random() - 0.5) * 8.0
          
          p.text.text = `0x${Math.floor(Math.random()*65535).toString(16).toUpperCase()}`
          p.text.enabled = true
          p.text.getSceneObject().getTransform().setLocalPosition(new vec3(p.x, p.y, zDepth))
        }
      }
      
      particles.forEach(p => {
        if (p.life > 0) {
          p.life -= dt
          // Chaotic speed: sometimes they burst up quickly
          const currentSpeed = p.speed * (Math.random() > 0.85 ? 4.0 : 1.0)
          p.y += dt * currentSpeed // float up
          
          // Chaotic horizontal glitch
          const glitchX = p.x + (Math.random() > 0.9 ? (Math.random() - 0.5) * 3.0 : 0)
          
          // Preserve their initial Z depth as they float up
          const currentZ = p.text.getSceneObject().getTransform().getLocalPosition().z
          p.text.getSceneObject().getTransform().setLocalPosition(new vec3(glitchX, p.y, currentZ))
          
          // Chaotic text swapping: occasionally change the hex code mid-flight
          if (Math.random() > 0.92) {
            p.text.text = `0x${Math.floor(Math.random()*65535).toString(16).toUpperCase()}`
          }
          
          // Chaotic flickering: randomize alpha heavily
          const flickerAlpha = Math.min(1.0, p.life) * (Math.random() > 0.8 ? 0.1 : 0.8)
          p.text.textFill.color = new vec4(C_CRITICAL.x, C_CRITICAL.y, C_CRITICAL.z, flickerAlpha)
          if (p.life <= 0) p.text.enabled = false
        }
      })
    })
  }

  private rebuildList(): void {
    this.cells.forEach((cell) => cell.destroy())
    this.cells = []

    this.countText.text = `${this.devices.length} ENTITIES`

    this.devices.forEach((device, index) => {
      const type = guessDeviceType(device, index)
      const prefab = type === "phone" ? this.phonePrefab : (type === "router" ? this.routerPrefab : this.laptopPrefab)

      // The phone model is a bit too large compared to the others, so we scale it down specifically
      const finalScale = type === "phone" ? this.modelScale * 0.4 : this.modelScale
      // Shift the phone down a bit so it sits perfectly in the cell
      const finalOffsetY = type === "phone" ? this.modelOffsetY - 4.0 : this.modelOffsetY

      this.cells.push(
        new Device3DView(
          this.listRoot,
          this.layer,
          device,
          index,
          prefab,
          finalScale,
          finalOffsetY,
          this.modelOffsetZ,
          (selectedDevice) => {
            if (this.selectAudio) {
              this.selectAudio.play(1)
            }
            this.beginPinMode(selectedDevice)
          }
        )
      )
    })

    this.listRoot.getTransform().setLocalPosition(new vec3(0, 0, 0.6))
    
    // Ensure cells start with correct alpha
    this.cells.forEach(cell => {
      cell.updateGlobalAlpha(cell.baseYPosition)
    })
  }

  private playBootAnimation(): void {
    const transform = this.panelRoot.getTransform()
    transform.setLocalScale(new vec3(0.1, 0.1, 1.0))
    animate({
      duration: 0.5,
      easing: "ease-out-back",
      update: (t: number) => {
        transform.setLocalScale(new vec3(t, t, 1.0))
      }
    })
  }

  public show(): void {
    if (!this.initialized || !this.panelRoot || !this.cameraRoot) return
    
    // World-lock the grid directly in front of where the user is currently looking
    const camTransform = this.cameraRoot.getTransform()
    const camPos = camTransform.getWorldPosition()
    const camRot = camTransform.getWorldRotation()
    
    // -88 on Z is forward in camera local space
    const localOffset = new vec3(0, 0, PANEL_DISTANCE)
    const worldOffset = camRot.multiplyVec3(localOffset)
    const targetPos = camPos.add(worldOffset)
    
    this.panelRoot.getTransform().setWorldPosition(targetPos)
    
    // Make the grid face the user's current position perfectly
    const lookDir = camPos.sub(targetPos)
    lookDir.y = 0 // keep it completely upright (billboard style)
    if (lookDir.lengthSquared > 0.001) {
      this.panelRoot.getTransform().setWorldRotation(quat.lookAt(lookDir.normalize(), vec3.up()))
    }

    this.panelRoot.enabled = true
    this.playBootAnimation()
    
    // Fetch latest data when opening the panel
    this.fetchData()
  }

  public hide(): void {
    if (this.panelRoot) {
      this.panelRoot.enabled = false
    }
  }

  private beginPinMode(device: Device): void {
    log.d(`Pin mode requested for ${device.bt_name || device.hostname}`)
    this.onDeviceReadyToPin?.(device)

    // Hide the main list panel
    if (this.panelRoot) {
      this.panelRoot.enabled = false
    }

    if (!this.cameraRoot) {
      log.w("No camera root provided to DeviceListPanel, cannot use placement mode.")
      return
    }

    // Determine the correct prefab
    const index = this.devices.indexOf(device)
    const type = guessDeviceType(device, index >= 0 ? index : 0)
    let prefab: ObjectPrefab | undefined = undefined
    if (type === "phone") prefab = this.phonePrefab
    else if (type === "router") prefab = this.routerPrefab
    else prefab = this.laptopPrefab

    // Launch placement mode
    new DevicePlacer(
      this.sceneObject,
      this.layer,
      this.cameraRoot,
      device,
      prefab,
      this.modelScale,
      (placer, finalPos) => {
        // Destroy the placer (ghost model)
        placer.destroy()

        if (this.anchorAudio) {
          this.anchorAudio.play(1)
        }

        const deviceId = device.deviceId

        // Destroy the old panel if the user is relocating the same device
        if (this.activeDetailPanels.has(deviceId)) {
          log.d(`Relocating device ${deviceId}. Destroying previous indicator.`)
          this.activeDetailPanels.get(deviceId)?.destroy()
          this.activeDetailPanels.delete(deviceId)
        }

        const apiUrlBase = this.websocketUrl.replace("ws://", "http://").replace("wss://", "https://").replace("/ws/devices", "")
        const detailPanel = new DeviceDetailPanel(
          this.sceneObject,
          this.layer,
          this.cameraRoot,
          device,
          finalPos,
          this.indicatorPrefab,
          this.indicatorScale,
          this.indicatorMaterial,
          this.tripleMonitorPrefab,
          this.centerUIScale,
          this.centerUIOffset,
          this.centerUIRot,
          this.leftUIScale,
          this.leftUIOffset,
          this.leftUIRot,
          this.rightUIScale,
          this.rightUIOffset,
          this.rightUIRot,
          apiUrlBase,
          this.shellTerminalPrefab,
          this.shellTerminalScale,
          this.shellTerminalOffset,
          this.notebookPrefab,
          this.notebookScale,
          this.notebookOffset,
          this.notebookTitlePos,
          this.notebookTextPos,
          this.notebookCloseBtnPos,
          this.analyzeAudio,
          this.openAudio,
          this.selectAudio
        )

        this.activeDetailPanels.set(deviceId, detailPanel)
      }
    )
  }
}
