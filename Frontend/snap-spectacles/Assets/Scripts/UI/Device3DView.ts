/**
 * Device3DView.ts
 * One holographic device cell (3D model + labels + hover info + interaction collider),
 * extracted verbatim from DeviceListPanel.ts. The grid/cell layout constants live here
 * because this is their primary consumer.
 */

import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import {RoundedRectangleVisual} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual"

import {Device} from "../Data/DeviceTypes"
import {
  threatColor,
  C_WHITE,
  C_CYAN,
  C_DIM,
  C_LOW,
  C_HOVER_BG,
  FS_SMALL,
  FS_LABEL
} from "./Theme"
import {makeObject, makeText, makePlate} from "./UiBuilders"

// 3D Grid Dimensions
export const COLUMNS = 3
export const CELL_W = 20.0
export const CELL_H = 24.0
export const CELL_GAP_X = 2.0
export const CELL_GAP_Y = 2.0
export const CELL_STEP_X = CELL_W + CELL_GAP_X
export const CELL_STEP_Y = CELL_H + CELL_GAP_Y
export const GRID_START_X = -((COLUMNS - 1) * CELL_STEP_X) / 2.0
export const GRID_START_Y = 4.0
export const FADE_START_Y = 12.0
export const FADE_END_Y = 16.0

export class Device3DView {
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
