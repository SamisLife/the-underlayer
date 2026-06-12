import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {RoundedRectangleVisual} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual"
import {Device} from "./Data/DeviceTypes"
import {
  C_CYAN,
  C_DIM,
  C_WHITE,
  FS_TITLE,
  FS_BODY,
  FS_SMALL,
  FS_TINY,
  threatColor,
  threatLabel,
  makeObject,
  makeText,
  makePlate
} from "./DeviceListPanel"

export class DeviceDetailPanel {
  private panelRoot: SceneObject
  private indicatorRoot: SceneObject
  private uiRoot: SceneObject
  private indicatorBaseY: number = 15.0

  constructor(
    parentRoot: SceneObject,
    private layer: LayerSet,
    private cameraRoot: SceneObject,
    public device: Device,
    worldPos: vec3,
    private indicatorPrefab?: ObjectPrefab,
    private indicatorScale: number = 1.0,
    private indicatorMaterial?: Material
  ) {
    // Create the main panel root at the chosen world position
    this.panelRoot = makeObject(parentRoot, layer, `UL_Detail_${device.hostname}`)
    this.panelRoot.getTransform().setWorldPosition(worldPos)

    // Make the panel face the user
    const camTransform = this.cameraRoot.getTransform()
    const lookDir = camTransform.getWorldPosition().sub(worldPos)
    lookDir.y = 0 // keep it upright
    if (lookDir.lengthSquared > 0.001) {
      const rot = quat.lookAt(lookDir.normalize(), vec3.up())
      this.panelRoot.getTransform().setWorldRotation(rot)
    }

    this.buildUI()
  }

  private buildUI(): void {
    // 1. Build the Indicator (Custom Prefab or Small Red Hacker Beacon)
    this.indicatorRoot = makeObject(this.panelRoot, this.layer, "Indicator_Root", new vec3(0, this.indicatorBaseY, 0))
    
    if (this.indicatorPrefab) {
      // Use the provided custom 3D model
      const meshObj = this.indicatorPrefab.instantiate(this.indicatorRoot)
      meshObj.getTransform().setLocalScale(new vec3(this.indicatorScale, this.indicatorScale, this.indicatorScale))
      
      // If a glowing material was provided, recursively apply it to all meshes
      if (this.indicatorMaterial) {
        this.applyMaterialRecursive(meshObj, this.indicatorMaterial)
      }
    } else {
      // Fallback to the default <!> red beacon
      makePlate(this.indicatorRoot, this.layer, "IndBg", new vec2(8.0, 8.0), vec3.zero(), new vec4(0.2, 0, 0, 0.8), 4.0, new vec4(1, 0, 0, 1), 0.5, 2.0)
      makeText(this.indicatorRoot, this.layer, "IndTxt", "<!>", FS_BODY, new vec4(1, 0.2, 0.2, 1), new vec3(0, 0, 0.2), 6.0, 6.0)
    }

    const indScript = this.indicatorRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const indBtn = this.indicatorRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    indBtn.size = new vec3(10.0, 10.0, 10.0) // Large enough clickable volume for any 3D indicator
    indBtn.initialize()
    
    // Destroy the SIK visual so it doesn't render any UI background/menu behind the custom 3D model
    if (indBtn.visual) {
      const v = indBtn.visual as any
      if (typeof v.destroy === 'function') v.destroy()
      else if (v.getSceneObject) v.getSceneObject().destroy()
      else if (v.sceneObject) v.sceneObject.destroy()
    }

    indBtn.onTriggerUp.add(() => this.setExpanded(true))

    // 2. Build the Full UI (The detailed panel)
    this.uiRoot = makeObject(this.panelRoot, this.layer, "UI_Root", new vec3(0, 30.0, 0))

    const width = 40.0
    const height = 30.0

    // Background plate
    makePlate(this.uiRoot, this.layer, "Background", new vec2(width, height), vec3.zero(), new vec4(0.02, 0.05, 0.08, 0.9), 10, C_CYAN, 0.5, 0.5)

    // Header (Device Name)
    makeText(this.uiRoot, this.layer, "Header", this.device.hostname, FS_TITLE, C_WHITE, new vec3(0, height / 2 - 4.0, 0.5), width - 4.0, 8.0)

    // Threat Level
    const tLevel = this.device.ar_summary?.threatLevel || "unknown"
    const tColor = threatColor(tLevel)
    makeText(this.uiRoot, this.layer, "Threat", `THREAT: ${threatLabel(tLevel)}`, FS_SMALL, tColor, new vec3(0, height / 2 - 10.0, 0.5), width - 4.0, 6.0)

    // Mockup Details
    const details = `IP: ${this.device.ip}\nOS: ${this.device.ar_summary?.os || "UNKNOWN"}\nCVEs: ${this.device.ar_summary?.cveCount || 0}`
    makeText(this.uiRoot, this.layer, "Details", details, FS_TINY, C_CYAN, new vec3(0, -2.0, 0.5), width - 4.0, 15.0)

    // Minimize Button
    const minRoot = makeObject(this.uiRoot, this.layer, "MinimizeBtn", new vec3(0, -height / 2 + 4.0, 1.0))
    makePlate(minRoot, this.layer, "MinBg", new vec2(6.0, 4.0), vec3.zero(), new vec4(0.2, 0, 0, 0.8), 10, new vec4(1, 0, 0, 1), 0.2, 1.0)
    makeText(minRoot, this.layer, "MinTxt", "X", FS_SMALL, new vec4(1, 0, 0, 1), new vec3(0, 0, 0.2), 4.0, 4.0)

    const minScript = minRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const minBtn = minRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    minBtn.size = new vec3(6.0, 4.0, 2.0)
    minBtn.initialize()
    this.configureBtn(minBtn, () => this.setExpanded(false))

    // Start minimized
    this.setExpanded(false)

    // Animation Loop
    const script = this.panelRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const updateEvent = script.createEvent("UpdateEvent") as UpdateEvent
    updateEvent.bind(() => this.onUpdate())
  }

  private onUpdate(): void {
    if (this.indicatorRoot && this.indicatorRoot.enabled) {
      const time = getTime()
      
      // Rotate constantly around Y axis
      const rot = quat.angleAxis(time * 2.0, vec3.up())
      this.indicatorRoot.getTransform().setLocalRotation(rot)
      
      // Hover up and down slightly
      const hover = Math.sin(time * 3.0) * 2.0 // +/- 2cm amplitude
      this.indicatorRoot.getTransform().setLocalPosition(new vec3(0, this.indicatorBaseY + hover, 0))
    }
  }

  private applyMaterialRecursive(obj: SceneObject, mat: Material): void {
    const renderMeshes = obj.getComponents("Component.RenderMeshVisual")
    renderMeshes.forEach(mesh => {
      mesh.mainMaterial = mat
    })
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.applyMaterialRecursive(obj.getChild(i), mat)
    }
  }

  private configureBtn(btn: RectangleButton, tapCallback: () => void): void {
    btn.onTriggerUp.add(tapCallback)
    const visual = btn.visual as RoundedRectangleVisual
    if (visual) {
      visual.shouldColorChange = false
      visual.baseDefaultColor = new vec4(0, 0, 0, 0)
      visual.baseHoveredColor = new vec4(0, 0, 0, 0)
      visual.baseTriggeredColor = new vec4(0, 0, 0, 0)
      visual.defaultHasBorder = false
    }
  }

  private setExpanded(expanded: boolean): void {
    this.indicatorRoot.enabled = !expanded
    this.uiRoot.enabled = expanded
  }

  public destroy(): void {
    if (this.panelRoot) {
      this.panelRoot.destroy()
    }
  }
}
