import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {RoundedRectangleVisual} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual"
import {DeviceListPanel, makeObject, makePlate, makeText, C_CYAN, C_DIM, C_WHITE, FS_TITLE, FS_SMALL} from "./DeviceListPanel"
import {lerp} from "SpectaclesInteractionKit.lspkg/Utils/mathUtils"

@component
export class MainMenuController extends BaseScriptComponent {
  @input
  @hint("The main camera so the menu can follow it")
  cameraRoot: SceneObject

  @input
  @hint("Reference to the DeviceListPanel component in the scene")
  deviceListPanel: ScriptComponent

  private menuRoot: SceneObject
  private layer: LayerSet

  private state: "MINIMIZED" | "EXPANDED" | "SCAN" | "DEVICES" = "MINIMIZED"

  private minimizedBtnRoot: SceneObject
  private expandedContainer: SceneObject
  private scanContainer: SceneObject
  private devicesBackContainer: SceneObject

  onAwake(): void {
    const delayed = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    delayed.bind(() => this.init())
    delayed.reset(0.2) // Wait slightly for DeviceListPanel to init
  }

  private init(): void {
    if (!this.cameraRoot) {
      print("MainMenuController needs a cameraRoot!")
      return
    }

    const camera = this.cameraRoot.getComponent("Component.Camera") as Camera
    this.layer = camera ? camera.renderLayer : this.sceneObject.layer

    this.menuRoot = global.scene.createSceneObject("UL_MainMenuContainer")
    this.menuRoot.layer = this.layer

    this.buildMinimizedMenu()
    this.buildExpandedMenu()
    this.buildScanMenu()
    this.buildDevicesBackMenu()

    this.switchState("MINIMIZED")

    const dlPanel = this.deviceListPanel as unknown as DeviceListPanel
    if (dlPanel) {
      dlPanel.onDeviceReadyToPin = () => {
        this.switchState("MINIMIZED")
      }
    }

    const updateEvent = this.createEvent("UpdateEvent") as UpdateEvent
    updateEvent.bind(() => this.onUpdate())
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

  private buildMinimizedMenu(): void {
    this.minimizedBtnRoot = makeObject(this.menuRoot, this.layer, "Btn_Minimized")
    
    makePlate(this.minimizedBtnRoot, this.layer, "Bg", new vec2(20.0, 6.0), vec3.zero(), C_DIM, 10, C_CYAN, 0.2, 3.0)
    makeText(this.minimizedBtnRoot, this.layer, "Txt", "THE UNDERLAYER", FS_SMALL, C_CYAN, new vec3(0, 0, 0.2), 18.0, 4.0)

    const script = this.minimizedBtnRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const btn = this.minimizedBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    btn.size = new vec3(20.0, 6.0, 2.0)
    btn.initialize()
    
    this.configureBtn(btn, () => this.switchState("EXPANDED"))
  }

  private buildExpandedMenu(): void {
    this.expandedContainer = makeObject(this.menuRoot, this.layer, "Container_Expanded")

    // SCAN BUTTON
    const scanRoot = makeObject(this.expandedContainer, this.layer, "Btn_Scan", new vec3(-8.0, 0, 0))
    makePlate(scanRoot, this.layer, "Bg", new vec2(14.0, 6.0), vec3.zero(), C_DIM, 10, C_WHITE, 0.1, 1.0)
    makeText(scanRoot, this.layer, "Txt", "SCAN", FS_SMALL, C_WHITE, new vec3(0, 0, 0.2), 12.0, 4.0)
    
    const scanScript = scanRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const scanBtn = scanRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    scanBtn.size = new vec3(14.0, 6.0, 2.0)
    scanBtn.initialize()
    this.configureBtn(scanBtn, () => this.switchState("SCAN"))

    // DEVICES BUTTON
    const devRoot = makeObject(this.expandedContainer, this.layer, "Btn_Devices", new vec3(8.0, 0, 0))
    makePlate(devRoot, this.layer, "Bg", new vec2(14.0, 6.0), vec3.zero(), C_DIM, 10, C_CYAN, 0.1, 1.0)
    makeText(devRoot, this.layer, "Txt", "DEVICES", FS_SMALL, C_CYAN, new vec3(0, 0, 0.2), 12.0, 4.0)
    
    const devScript = devRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const devBtn = devRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    devBtn.size = new vec3(14.0, 6.0, 2.0)
    devBtn.initialize()
    this.configureBtn(devBtn, () => this.switchState("DEVICES"))

    // CLOSE BUTTON
    const closeRoot = makeObject(this.expandedContainer, this.layer, "Btn_Close", new vec3(0, -6.0, 0))
    makePlate(closeRoot, this.layer, "Bg", new vec2(6.0, 4.0), vec3.zero(), new vec4(0.2, 0.05, 0.05, 0.8), 10, new vec4(1, 0, 0, 1), 0.1, 1.0)
    makeText(closeRoot, this.layer, "Txt", "X", FS_SMALL, new vec4(1, 0, 0, 1), new vec3(0, 0, 0.2), 4.0, 4.0)
    
    const closeScript = closeRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const closeBtn = closeRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    closeBtn.size = new vec3(6.0, 4.0, 2.0)
    closeBtn.initialize()
    this.configureBtn(closeBtn, () => this.switchState("MINIMIZED"))
  }

  private buildScanMenu(): void {
    this.scanContainer = makeObject(this.menuRoot, this.layer, "Container_Scan")

    makeText(this.scanContainer, this.layer, "Txt", "SCANNING...", FS_TITLE, C_CYAN, new vec3(0, 6.0, 0), 20.0, 8.0)

    const backRoot = makeObject(this.scanContainer, this.layer, "Btn_Back", new vec3(0, -2.0, 0))
    makePlate(backRoot, this.layer, "Bg", new vec2(12.0, 4.0), vec3.zero(), C_DIM, 10, C_WHITE, 0.1, 1.0)
    makeText(backRoot, this.layer, "Txt", "< BACK", FS_SMALL, C_WHITE, new vec3(0, 0, 0.2), 10.0, 4.0)
    
    const backScript = backRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const backBtn = backRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    backBtn.size = new vec3(12.0, 4.0, 2.0)
    backBtn.initialize()
    this.configureBtn(backBtn, () => this.switchState("EXPANDED"))
  }

  private buildDevicesBackMenu(): void {
    this.devicesBackContainer = makeObject(this.menuRoot, this.layer, "Container_DevicesBack")

    const closeRoot = makeObject(this.devicesBackContainer, this.layer, "Btn_Close", vec3.zero())
    makePlate(closeRoot, this.layer, "Bg", new vec2(6.0, 4.0), vec3.zero(), new vec4(0.2, 0.05, 0.05, 0.8), 10, new vec4(1, 0, 0, 1), 0.1, 1.0)
    makeText(closeRoot, this.layer, "Txt", "X", FS_SMALL, new vec4(1, 0, 0, 1), new vec3(0, 0, 0.2), 4.0, 4.0)
    
    const closeScript = closeRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const closeBtn = closeRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    closeBtn.size = new vec3(6.0, 4.0, 2.0)
    closeBtn.initialize()
    this.configureBtn(closeBtn, () => this.switchState("EXPANDED"))
  }

  private switchState(newState: "MINIMIZED" | "EXPANDED" | "SCAN" | "DEVICES"): void {
    this.state = newState

    this.minimizedBtnRoot.enabled = (newState === "MINIMIZED")
    this.expandedContainer.enabled = (newState === "EXPANDED")
    this.scanContainer.enabled = (newState === "SCAN")
    this.devicesBackContainer.enabled = (newState === "DEVICES")

    const dlPanel = this.deviceListPanel as unknown as DeviceListPanel
    if (dlPanel) {
      if (newState === "DEVICES") {
        dlPanel.show()
      } else {
        dlPanel.hide()
      }
    }
  }

  private onUpdate(): void {
    if (!this.menuRoot || !this.cameraRoot) return

    // Smooth follow logic: 
    const camPos = this.cameraRoot.getTransform().getWorldPosition()
    const forward = this.cameraRoot.getTransform().forward
    const up = this.cameraRoot.getTransform().up
    
    let desiredPosition = camPos.add(forward.uniformScale(-80.0))
    desiredPosition = desiredPosition.add(up.uniformScale(-15.0))
    
    const currentPos = this.menuRoot.getTransform().getWorldPosition()
    this.menuRoot.getTransform().setWorldPosition(vec3.lerp(currentPos, desiredPosition, getDeltaTime() * 10))
    
    const desiredRotation = quat.lookAt(forward, vec3.up())
    const currentRot = this.menuRoot.getTransform().getWorldRotation()
    this.menuRoot.getTransform().setWorldRotation(quat.slerp(currentRot, desiredRotation, getDeltaTime() * 10))
  }
}
