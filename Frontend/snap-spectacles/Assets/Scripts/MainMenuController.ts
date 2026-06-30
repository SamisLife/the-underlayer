/**
 * MainMenuController.ts
 * The floating main menu / HUD. Manages the MINIMIZED / EXPANDED / SCAN / DEVICES states, follows the
 * camera, and drives the SCAN flow (world-scan effect + backend scan trigger) and the DEMO MODE
 * toggle. Shows/hides the DeviceListPanel.
 */

import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {RoundedRectangleVisual} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {TargetingMode} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {DeviceListPanel} from "./DeviceListPanel"
import {makeObject, makePlate, makeText} from "./UI/UiBuilders"
import {C_CYAN, C_DIM, C_WHITE, FS_TITLE, FS_SMALL} from "./UI/Theme"
import {DemoState} from "./Data/DeviceTypes"
import {lerp} from "SpectaclesInteractionKit.lspkg/Utils/mathUtils"
import NativeLogger from "SpectaclesInteractionKit.lspkg/Utils/NativeLogger"

const log = new NativeLogger("MainMenu")

@component
export class MainMenuController extends BaseScriptComponent {
  @input
  @hint("The main camera so the menu can follow it")
  cameraRoot: SceneObject

  @input
  @hint("Reference to the DeviceListPanel component in the scene")
  deviceListPanel: ScriptComponent

  @input
  @allowUndefined
  @hint("Optional: Reference to the WorldScannerEffect component")
  worldScanner: ScriptComponent
  
  @input
  @allowUndefined
  @hint("ESP32 Hologram Prefab")
  esp32Prefab: ObjectPrefab

  @input
  @allowUndefined
  @hint("Sound for clicking buttons")
  clickAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Snap UI Toggle Prefab for Demo Mode")
  uiTogglePrefab: ObjectPrefab

  @input
  @allowUndefined
  @hint("Looping sound during scan")
  scanningAudio: AudioComponent

  private menuRoot: SceneObject
  private layer: LayerSet

  private state: "MINIMIZED" | "EXPANDED" | "SCAN" | "DEVICES" = "MINIMIZED"

  private minimizedBtnRoot: SceneObject
  private demoBtnRoot: SceneObject
  private expandedContainer: SceneObject
  private scanContainer: SceneObject
  private devicesBackContainer: SceneObject

  private scanBtnRoot: SceneObject
  private devBtnRoot: SceneObject
  private expandedCloseBtnRoot: SceneObject
  
  private scanWire: { root: SceneObject, plate: any }
  private devWire: { root: SceneObject, plate: any }
  
  private particles: SceneObject[] = []
  private esp32Model: SceneObject | null = null
  private scanRadarRings: {root: SceneObject, plate: any}[] = []
  
  private currentLerp: number = 0
  private lastLerp: number = -1

  onAwake(): void {
    const delayed = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    delayed.bind(() => this.init())
    delayed.reset(0.2) // Wait slightly for DeviceListPanel to init
  }

  private init(): void {
    if (!this.cameraRoot) {
      log.e("MainMenuController needs a cameraRoot!")
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
    
    // Create ambient particles
    for (let i = 0; i < 4; i++) {
      const p = makeObject(this.menuRoot, this.layer, `Particle_${i}`)
      makePlate(p, this.layer, "Plt", new vec2(0.6, 0.6), vec3.zero(), C_CYAN, 10)
      this.particles.push(p)
    }

    this.switchState("MINIMIZED")

    const dlPanel = this.deviceListPanel as unknown as DeviceListPanel
    if (dlPanel) {
      dlPanel.onDeviceReadyToPin = () => {
        this.switchState("MINIMIZED")
      }
    }

    const updateEvent = this.createEvent("UpdateEvent") as UpdateEvent
    this.buildDemoMenu()
    
    updateEvent.bind(() => this.onUpdate())
  }

  private buildDemoMenu(): void {
    if (this.uiTogglePrefab) {
      // Parent to menuRoot so it doesn't open the menu when clicked
      this.demoBtnRoot = makeObject(this.menuRoot, this.layer, "Btn_Demo")
      this.demoBtnRoot.getTransform().setLocalPosition(new vec3(0, -6.0, 0))

      const toggleObj = this.uiTogglePrefab.instantiate(this.demoBtnRoot)
      toggleObj.getTransform().setLocalPosition(new vec3(-3.0, 0, 0))

      // Text shifted 30% left and 2.5% lower (Y: 0.25)
      const demoTxt = makeText(this.demoBtnRoot, this.layer, "Txt", "DEMO MODE", FS_SMALL, DemoState.isDemoMode ? C_CYAN : C_DIM, new vec3(1.5, 0.25, 0.2), 15.0, 4.0)

      // Invisible click catcher
      const clickerRoot = makeObject(this.demoBtnRoot, this.layer, "Clicker")
      const collider = clickerRoot.createComponent("Physics.ColliderComponent") as ColliderComponent
      collider.fitVisual = false
      const boxShape = Shape.createBoxShape()
      boxShape.size = new vec3(22.0, 6.0, 2.0)
      collider.shape = boxShape

      const interactable = clickerRoot.createComponent(Interactable.getTypeName()) as Interactable
      interactable.targetingMode = TargetingMode.All

      let toggleScript: any = null
      let nativelyBound = false
      const scripts = toggleObj.getComponents("Component.ScriptComponent") as ScriptComponent[]
      for (let i = 0; i < scripts.length; i++) {
        const s = scripts[i] as any
        if (s.onValueChange || s.onStateChanged || s.toggle || (s.api && s.api.toggle)) {
          toggleScript = s
        }
        
        // Always listen to the native toggle events in case the user clicks the toggle's own hitbox!
        if (s.onValueChange && typeof s.onValueChange.add === "function") {
          s.onValueChange.add((isOn: boolean) => {
            DemoState.isDemoMode = isOn
            demoTxt.textFill.color = isOn ? C_CYAN : C_DIM
          })
          nativelyBound = true
        } else if (s.onStateChanged && typeof s.onStateChanged.add === "function") {
          s.onStateChanged.add((isOn: boolean) => {
            DemoState.isDemoMode = isOn
            demoTxt.textFill.color = isOn ? C_CYAN : C_DIM
          })
          nativelyBound = true
        }
      }

      // Force the Toggle prefab's visual state to match our code's default DemoState (false)
      // MUST BE DEFERRED to prevent SIK lifecycle race conditions overriding our command!
      if (toggleScript) {
         let hasSynced = false
         const syncEvent = this.createEvent("UpdateEvent")
         syncEvent.bind(() => {
             if (!hasSynced) {
                 hasSynced = true
                 
                 // Now that SIK is fully initialized, force the visual state to match our code
                 if (typeof toggleScript.toggle === "function") {
                     // If it exposes isToggledOn, ensure we don't double-toggle if it's already in the correct state
                     const currentlyOn = ('isToggledOn' in toggleScript) ? toggleScript.isToggledOn : true
                     if (currentlyOn !== DemoState.isDemoMode) toggleScript.toggle()
                 }
                 else if (typeof toggleScript.setState === "function") toggleScript.setState(DemoState.isDemoMode)
                 else if (toggleScript.api && typeof toggleScript.api.setState === "function") toggleScript.api.setState(DemoState.isDemoMode)
                 else if ('isToggledOn' in toggleScript) toggleScript.isToggledOn = DemoState.isDemoMode
                 
                 // Remove this event so it only runs once
                 this.removeEvent(syncEvent)
             }
         })
      }

      interactable.onTriggerEnd.add(() => {
        if (toggleScript) {
           // We ask the toggle script to flip. Its event handler will update DemoState for us!
           if (typeof toggleScript.toggle === "function") toggleScript.toggle()
           else if (toggleScript.api && typeof toggleScript.api.toggle === "function") toggleScript.api.toggle()
           else if (typeof toggleScript.setState === "function") toggleScript.setState(!DemoState.isDemoMode)
           else if (toggleScript.api && typeof toggleScript.api.setState === "function") toggleScript.api.setState(!DemoState.isDemoMode)
        }
        
        // If we somehow failed to bind natively, fallback to manual state sync
        if (!nativelyBound) {
           DemoState.isDemoMode = !DemoState.isDemoMode
           demoTxt.textFill.color = DemoState.isDemoMode ? C_CYAN : C_DIM
        }
      })

      return
    }

    // Fallback programmatic toggle if the prefab isn't linked
    this.demoBtnRoot = makeObject(this.minimizedBtnRoot, this.layer, "Btn_Demo")
    this.demoBtnRoot.getTransform().setLocalPosition(new vec3(0, -6.0, 0))

    const demoTxt = makeText(this.demoBtnRoot, this.layer, "Txt", "[ ] DEMO MODE", FS_SMALL, C_DIM, new vec3(0, 0, 0.2), 15.0, 4.0)

    const demoScript = this.demoBtnRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const demoBtn = this.demoBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    demoBtn.size = new vec3(15.0, 4.0, 2.0)
    demoBtn.initialize()

    this.configureBtn(demoBtn, new vec4(0.1, 0.1, 0.1, 0.0), C_CYAN, () => {
      DemoState.isDemoMode = !DemoState.isDemoMode
      demoTxt.text = DemoState.isDemoMode ? "[X] DEMO MODE" : "[ ] DEMO MODE"
      demoTxt.textFill.color = DemoState.isDemoMode ? C_CYAN : C_DIM
      if (demoBtn.visual) {
         const v = demoBtn.visual as RoundedRectangleVisual
         v.baseDefaultColor = DemoState.isDemoMode ? new vec4(0.05, 0.25, 0.25, 0.3) : new vec4(0.1, 0.1, 0.1, 0.0)
         v.baseHoveredColor = new vec4(v.baseDefaultColor.r + 0.1, v.baseDefaultColor.g + 0.1, v.baseDefaultColor.b + 0.6, 1.0)
         v.baseTriggeredColor = new vec4(v.baseDefaultColor.r + 0.2, v.baseDefaultColor.g + 0.2, v.baseDefaultColor.b + 0.8, 1.0)
      }
    })
  }

  private configureBtn(btn: RectangleButton, defaultColor: vec4, borderColor: vec4, tapCallback: () => void): void {
    btn.onTriggerUp.add(tapCallback)
    const visual = btn.visual as RoundedRectangleVisual
    if (visual) {
      visual.shouldColorChange = true
      visual.baseDefaultColor = defaultColor
      visual.baseHoveredColor = new vec4(defaultColor.r + 0.1, defaultColor.g + 0.1, defaultColor.b + 0.1, defaultColor.a + 0.2)
      visual.baseTriggeredColor = new vec4(defaultColor.r + 0.2, defaultColor.g + 0.2, defaultColor.b + 0.2, defaultColor.a + 0.4)
      visual.defaultHasBorder = false
    }
  }

  private buildMinimizedMenu(): void {
    this.minimizedBtnRoot = makeObject(this.menuRoot, this.layer, "Btn_Minimized")
    
    makeText(this.minimizedBtnRoot, this.layer, "Txt", "THE UNDERLAYER", FS_SMALL, C_CYAN, new vec3(0, 0, 0.2), 18.0, 4.0)

    const script = this.minimizedBtnRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const btn = this.minimizedBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    btn.size = new vec3(20.0, 6.0, 2.0)
    btn.initialize()
    
    this.configureBtn(btn, C_DIM, C_CYAN, () => this.switchState("EXPANDED"))
  }

  private createWireframe(parent: SceneObject, name: string, color: vec4): { root: SceneObject, plate: any } {
    const root = makeObject(parent, this.layer, name)
    // Push the wireframe Z position back slightly so it sits behind the UI buttons
    const plate = makePlate(root, this.layer, "Plt", new vec2(1.0, 0.2), new vec3(0.5, 0, -1.0), color, -5)
    return { root, plate }
  }

  private updateWireframe(wire: { root: SceneObject, plate: any }, start: vec3, end: vec3): void {
    if (!wire || !wire.root) return
    const diff = end.sub(start)
    const length = diff.length
    if (length < 0.001) {
      wire.root.enabled = false
      return
    }
    wire.root.enabled = true
    wire.root.getTransform().setLocalPosition(start)
    const angle = Math.atan2(diff.y, diff.x)
    wire.root.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(0, 0, angle)))
    
    // Fix twitching: Instead of non-uniform scaling which breaks the mesh, directly update the plate size!
    if (wire.plate) {
      wire.plate.size = new vec2(length, 0.2)
      // We must also shift its local offset so it continues to stretch from the center correctly
      wire.plate.getSceneObject().getTransform().setLocalPosition(new vec3(length / 2, 0, -1.0))
    }
  }

  private buildExpandedMenu(): void {
    this.expandedContainer = makeObject(this.menuRoot, this.layer, "Container_Expanded")
    
    this.scanWire = this.createWireframe(this.expandedContainer, "Wire_Scan", C_CYAN)
    this.devWire = this.createWireframe(this.expandedContainer, "Wire_Dev", C_CYAN)

    // SCAN BUTTON
    this.scanBtnRoot = makeObject(this.expandedContainer, this.layer, "Btn_Scan", vec3.zero())
    makeText(this.scanBtnRoot, this.layer, "Txt", "SCAN", FS_SMALL, C_WHITE, new vec3(0, 0, 0.2), 12.0, 4.0)
    makeText(this.scanBtnRoot, this.layer, "B_L", "[", FS_SMALL, C_CYAN, new vec3(-5.5, 0, 0.2), 2.0, 4.0)
    makeText(this.scanBtnRoot, this.layer, "B_R", "]", FS_SMALL, C_CYAN, new vec3(5.5, 0, 0.2), 2.0, 4.0)
    
    const scanScript = this.scanBtnRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const scanBtn = this.scanBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    scanBtn.size = new vec3(14.0, 6.0, 2.0)
    scanBtn.initialize()
    this.configureBtn(scanBtn, C_DIM, C_WHITE, () => this.switchState("SCAN"))

    // DEVICES BUTTON
    this.devBtnRoot = makeObject(this.expandedContainer, this.layer, "Btn_Devices", vec3.zero())
    makeText(this.devBtnRoot, this.layer, "Txt", "DEVICES", FS_SMALL, C_CYAN, new vec3(0, 0, 0.2), 12.0, 4.0)
    makeText(this.devBtnRoot, this.layer, "B_L", "[", FS_SMALL, C_CYAN, new vec3(-5.5, 0, 0.2), 2.0, 4.0)
    makeText(this.devBtnRoot, this.layer, "B_R", "]", FS_SMALL, C_CYAN, new vec3(5.5, 0, 0.2), 2.0, 4.0)
    
    const devScript = this.devBtnRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const devBtn = this.devBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    devBtn.size = new vec3(14.0, 6.0, 2.0)
    devBtn.initialize()
    this.configureBtn(devBtn, C_DIM, C_CYAN, () => this.switchState("DEVICES"))

    // CLOSE BUTTON
    this.expandedCloseBtnRoot = makeObject(this.expandedContainer, this.layer, "Btn_Close", vec3.zero())
    makeText(this.expandedCloseBtnRoot, this.layer, "Txt", "X", FS_SMALL, new vec4(1, 0, 0, 1), new vec3(0, 0, 0.2), 4.0, 4.0)
    
    const closeScript = this.expandedCloseBtnRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const closeBtn = this.expandedCloseBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    closeBtn.size = new vec3(6.0, 4.0, 2.0)
    closeBtn.initialize()
    this.configureBtn(closeBtn, new vec4(0.2, 0.05, 0.05, 0.8), new vec4(1, 0, 0, 1), () => this.switchState("MINIMIZED"))
  }

  private buildScanMenu(): void {
    this.scanContainer = makeObject(this.menuRoot, this.layer, "Container_Scan")

    makeText(this.scanContainer, this.layer, "Txt", "SCANNING...", FS_TITLE, C_CYAN, new vec3(0, 6.0, 0), 20.0, 8.0)
    
    // ESP32 Hologram (moved slightly above the scanning text and pushed slightly forward)
    const modelRoot = makeObject(this.scanContainer, this.layer, "ESP32_Root", new vec3(0, 14.0, 5.0))
    
    // Pivot for the ESP32 (kept upright so it just spins 360 degrees)
    const espPivot = makeObject(modelRoot, this.layer, "ESP32_Pivot", vec3.zero())
    
    if (this.esp32Prefab) {
      this.esp32Model = this.esp32Prefab.instantiate(espPivot)
      // Balanced scale: smaller than before, but larger than the default 0.1
      this.esp32Model.getTransform().setLocalScale(new vec3(0.2, 0.2, 0.2))
    }
    
    // Radar Rings
    this.scanRadarRings = []
    for (let i = 0; i < 3; i++) {
      const ringRoot = makeObject(modelRoot, this.layer, `RadarRing_${i}`, vec3.zero())
      // Keep it facing the user directly (X-Y plane) by setting rotation to zero
      ringRoot.getTransform().setLocalRotation(quat.fromEulerVec(vec3.zero()))
      // To make a ring, background color is fully transparent (a=0), border color is cyan
      const ring = makePlate(ringRoot, this.layer, `RingPlt_${i}`, new vec2(20.0, 20.0), vec3.zero(), new vec4(0, 0, 0, 0), 10, C_CYAN, 0.5, 10.0)
      this.scanRadarRings.push({root: ringRoot, plate: ring})
    }

    const backRoot = makeObject(this.scanContainer, this.layer, "Btn_Back", new vec3(0, -2.0, 0))
    makeText(backRoot, this.layer, "Txt", "< BACK", FS_SMALL, C_WHITE, new vec3(0, 0, 0.2), 10.0, 4.0)
    
    const backScript = backRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const backBtn = backRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    backBtn.size = new vec3(12.0, 4.0, 2.0)
    backBtn.initialize()
    this.configureBtn(backBtn, C_DIM, C_WHITE, () => this.switchState("EXPANDED"))
  }

  private buildDevicesBackMenu(): void {
    this.devicesBackContainer = makeObject(this.menuRoot, this.layer, "Container_DevicesBack")

    const closeRoot = makeObject(this.devicesBackContainer, this.layer, "Btn_Close", vec3.zero())
    makeText(closeRoot, this.layer, "Txt", "X", FS_SMALL, new vec4(1, 0, 0, 1), new vec3(0, 0, 0.2), 4.0, 4.0)
    
    const closeScript = closeRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const closeBtn = closeRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    closeBtn.size = new vec3(6.0, 4.0, 2.0)
    closeBtn.initialize()
    this.configureBtn(closeBtn, new vec4(0.2, 0.05, 0.05, 0.8), new vec4(1, 0, 0, 1), () => this.switchState("EXPANDED"))
  }

  private switchState(newState: "MINIMIZED" | "EXPANDED" | "SCAN" | "DEVICES"): void {
    if (this.clickAudio) {
      this.clickAudio.play(1);
    }

    // Own the looping scan sound here, tied to the SCAN state, so it reliably starts and stops
    // even though WorldScannerEffect may sit on a disabled object whose timers never fire.
    if (this.scanningAudio) {
      if (newState === "SCAN") {
        this.scanningAudio.play(-1)
      } else {
        this.scanningAudio.stop(false)
      }
    }

    this.state = newState

    this.minimizedBtnRoot.enabled = (newState === "MINIMIZED" || newState === "EXPANDED")
    if (this.demoBtnRoot) {
      this.demoBtnRoot.enabled = (newState === "MINIMIZED")
    }
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

    // Trigger the 3D World Scanning effect if the user hits "SCAN"
    if (newState === "SCAN") {
      if (this.worldScanner) {
        const scanner = this.worldScanner as unknown as any
        if (typeof scanner.triggerScan === "function") {
          scanner.triggerScan()
        }
      }

      if (dlPanel) {
        const anyDlPanel = dlPanel as any
        if (typeof anyDlPanel.triggerBackendScan === "function") {
          anyDlPanel.triggerBackendScan((success: boolean) => {
            if (success) {
              this.switchState("DEVICES")
            } else {
              this.switchState("EXPANDED")
            }
          })
        }
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
    
    // Ambient Particle Orbiting
    const t = getTime()
    for (let i = 0; i < this.particles.length; i++) {
      const angle = t * 1.5 + (i * Math.PI / 2)
      // Pulsing radius between 16 and 18
      const rad = 17.0 + Math.sin(t * 2.0 + i) * 1.0
      this.particles[i].getTransform().setLocalPosition(new vec3(Math.cos(angle) * rad, Math.sin(angle) * rad, 0))
      this.particles[i].getTransform().setLocalRotation(quat.angleAxis(t * 3.0 + i, vec3.forward()))
    }

    // Animated Expansion Lerping
    const targetLerp = (this.state === "EXPANDED") ? 1.0 : 0.0
    
    if (Math.abs(this.currentLerp - targetLerp) < 0.005) {
      this.currentLerp = targetLerp
    } else {
      this.currentLerp = lerp(this.currentLerp, targetLerp, getDeltaTime() * 8.0)
    }

    if (this.currentLerp !== this.lastLerp) {
      this.lastLerp = this.currentLerp

      if (this.currentLerp > 0.01) {
        this.expandedContainer.enabled = true
        const l = this.currentLerp

        // Smooth floaty arc positions
        const sPos = vec3.lerp(vec3.zero(), new vec3(-16.0, 8.0, 0), l)
        const dPos = vec3.lerp(vec3.zero(), new vec3(16.0, 8.0, 0), l)
        const cPos = vec3.lerp(vec3.zero(), new vec3(0, -10.0, 0), l)

        this.scanBtnRoot.getTransform().setLocalPosition(sPos)
        this.devBtnRoot.getTransform().setLocalPosition(dPos)
        this.expandedCloseBtnRoot.getTransform().setLocalPosition(cPos)

        // Note: Intentionally NOT scaling the buttons to avoid breaking the SIK BoxShape physics colliders!
        this.scanBtnRoot.getTransform().setLocalScale(vec3.one())
        this.devBtnRoot.getTransform().setLocalScale(vec3.one())
        this.expandedCloseBtnRoot.getTransform().setLocalScale(vec3.one())

        this.updateWireframe(this.scanWire, vec3.zero(), sPos)
        this.updateWireframe(this.devWire, vec3.zero(), dPos)
      } else {
        this.expandedContainer.enabled = false
      }
    }

    // Scan Menu Animations
    if (this.state === "SCAN") {
      // Rotate the ESP32 Model
      if (this.esp32Model) {
        // Tilt the model 70 degrees forward, then spin it continuously around the vertical (Y) axis 
        // so it shows its front, sides, and back dynamically!
        const tilt = quat.fromEulerVec(new vec3(70 * Math.PI / 180, 0, 0))
        const spin = quat.angleAxis(t * 1.5, vec3.up())
        this.esp32Model.getTransform().setLocalRotation(spin.multiply(tilt))
        // A slight hover effect
        this.esp32Model.getTransform().setLocalPosition(new vec3(0, Math.sin(t * 3.0) * 2.0, 0))
      }

      // Radar rings expanding outwards
      for (let i = 0; i < this.scanRadarRings.length; i++) {
        const ringObj = this.scanRadarRings[i];
        // Phase shift each ring so they spawn sequentially
        const phase = (t * 0.4 + (i / this.scanRadarRings.length)) % 1.0;
        
        // Expand scale from 0.1 to 1.5 (smaller rings)
        const scale = 0.1 + phase * 1.5;
        ringObj.root.getTransform().setLocalScale(new vec3(scale, scale, scale));
        
        // Fade out opacity as it expands, with a much lower max opacity of 0.4
        if (ringObj.plate) {
           ringObj.plate.borderColor = new vec4(0, 1, 1, (1.0 - phase) * 0.4);
        }
      }
    }
  }
}
