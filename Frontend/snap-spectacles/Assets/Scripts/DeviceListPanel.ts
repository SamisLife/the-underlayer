/**
 * The Underlayer device list - 3D Holographic Edition
 *
 * Spawns 3D device models (Laptops, Phones, Routers) inside a
 * glowing outline menu, replacing the 2D flat rows.
 *
 * This is now a view-controller: data fetching/demo lives behind DeviceDataSourceProvider,
 * device state lives in DeviceStore, and the procedural UI helpers / Device3DView / theme live
 * under ./UI. The rendered scene graph is unchanged.
 */

import animate from "SpectaclesInteractionKit.lspkg/Utils/animate"
import NativeLogger from "SpectaclesInteractionKit.lspkg/Utils/NativeLogger"

import {Device} from "./Data/DeviceTypes"
import {guessDeviceType} from "./Data/DeviceParser"
import {DevicePlacer} from "./DevicePlacer"
import {DeviceDetailPanel} from "./DeviceDetailPanel"
import {HttpClient} from "./Net/HttpClient"
import {DeviceDataSourceProvider} from "./Services/DeviceDataSourceProvider"
import {DeviceStore} from "./State/DeviceStore"
import {
  setActiveHudFont,
  C_CYAN,
  C_CYAN_DIM,
  C_WHITE,
  FS_TITLE,
  FS_SMALL
} from "./UI/Theme"
import {makeObject, makePlate, makeText} from "./UI/UiBuilders"
import {Device3DView} from "./UI/Device3DView"

const log = new NativeLogger("UnderlayerList3D")

// Panel frame dimensions
const PANEL_DISTANCE = -140.0
const PANEL_W = 66.0
const PANEL_H = 46.0

const DEVICE_MODEL_LAYOUT = {
  scale: 0.51,
  phoneScaleMultiplier: 0.4,
  offsetY: -1.0,
  phoneOffsetYDelta: -4.0,
  offsetZ: 13.0
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
  @allowUndefined
  shellTerminalPrefab?: ObjectPrefab

  @input
  @allowUndefined
  notebookPrefab?: ObjectPrefab

  public onDeviceReadyToPin: ((device: Device) => void) | null = null

  private panelRoot: SceneObject
  private listRoot: SceneObject
  private headerRoot: SceneObject
  private layer: LayerSet
  private cells: Device3DView[] = []
  private initialized = false

  // Track active detail panels so placing a device again removes its previous instance.
  // Stays here (not in DeviceStore) because panel construction depends on scene assets.
  private activeDetailPanels: Map<string, DeviceDetailPanel> = new Map()

  private countText: Text

  private dataSource: DeviceDataSourceProvider

  onAwake(): void {
    const delayedInit = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    delayedInit.bind(() => this.init())
    delayedInit.reset(0.15)
  }

  public loadDevices(devices: Device[]): void {
    DeviceStore.getInstance().setDevices(devices)
  }

  public handleWebSocketMessage(rawMessage: string): void {
    try {
      const payload = JSON.parse(rawMessage) as Record<string, any>
      const eventName = payload.type || payload.event

      if (eventName === "initial_devices" && Array.isArray(payload.devices)) {
        this.applyInitialDevices(payload.devices as Device[])
        return
      }

      if (eventName === "device_updated" && payload.device) {
        // Store merges + normalizes and emits onDeviceUpdated, which drives the hot-swap below.
        DeviceStore.getInstance().applyDeviceUpdate(payload.device)
      }
    } catch (error) {
      log.e(`WebSocket parse error: ${error}`)
    }
  }

  private init(): void {
    if (this.initialized) return

    try {
      setActiveHudFont(this.hudFont)
      this.layer = this.resolveLayer()

      // Wire the data source once. Uses the existing websocketUrl @input for the base URL and
      // this component as the delay host for simulated/network timing. No new scene wiring.
      this.dataSource = DeviceDataSourceProvider.getInstance()
      this.dataSource.configure(new HttpClient(HttpClient.deriveBaseUrl(this.websocketUrl)), this)

      // Re-render whenever the device store changes; hot-swap a placed panel on single updates.
      const store = DeviceStore.getInstance()
      store.onDevicesChanged.add(() => this.rebuildList())
      store.onDeviceUpdated.add((device) => this.hotSwapDetailPanel(device))

      this.panelRoot = makeObject(this.sceneObject, this.layer, "UL_HoloMenu", new vec3(0, 0, PANEL_DISTANCE))

      this.buildWireframeOutline()
      this.buildHeader()

      this.listRoot = makeObject(this.panelRoot, this.layer, "UL_Grid", new vec3(0, 0, 0.6))

      this.initialized = true

      this.panelRoot.enabled = false // Start hidden

      log.d(`3D Holo Menu initialized`)

    } catch (error) {
      log.e(`HUD initialization failed: ${error}`)
    }
  }

  private fetchData(): void {
    log.d(`Fetching latest devices...`)
    this.refresh()
  }

  private refresh(): void {
    this.dataSource.getDevices().then(
      (devices) => this.applyInitialDevices(devices),
      (err) => log.e(`Device fetch failed: ${err}`)
    )
  }

  private applyInitialDevices(devices: Device[]): void {
    DeviceStore.getInstance().setDevices(devices)
    if (this.loadedAudio) {
      this.loadedAudio.play(1)
    }
  }

  public triggerBackendScan(onComplete: (success: boolean) => void): void {
    this.dataSource.triggerScan().then((success) => {
      // The original code played loadedAudio only on the live-scan success path.
      if (success && this.dataSource.isLive && this.loadedAudio) {
        this.loadedAudio.play(1)
      }
      onComplete(success)
    })
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

  private rebuildList(): void {
    this.cells.forEach((cell) => cell.destroy())
    this.cells = []

    const devices = DeviceStore.getInstance().getDevices()
    this.countText.text = `${devices.length} ENTITIES`

    devices.forEach((device, index) => {
      const type = guessDeviceType(device)
      const prefab = type === "phone" ? this.phonePrefab : (type === "router" ? this.routerPrefab : this.laptopPrefab)

      const finalScale = type === "phone" ? DEVICE_MODEL_LAYOUT.scale * DEVICE_MODEL_LAYOUT.phoneScaleMultiplier : DEVICE_MODEL_LAYOUT.scale
      const finalOffsetY = type === "phone" ? DEVICE_MODEL_LAYOUT.offsetY + DEVICE_MODEL_LAYOUT.phoneOffsetYDelta : DEVICE_MODEL_LAYOUT.offsetY

      this.cells.push(
        new Device3DView(
          this.listRoot,
          this.layer,
          device,
          index,
          prefab,
          finalScale,
          finalOffsetY,
          DEVICE_MODEL_LAYOUT.offsetZ,
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
    const type = guessDeviceType(device)
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
      DEVICE_MODEL_LAYOUT.scale,
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

        const detailPanel = this.createDetailPanel(device, finalPos, true)
        this.activeDetailPanels.set(deviceId, detailPanel)
      }
    )
  }

  /**
   * Hot-swap an already-placed detail panel when its device receives an update.
   * Subscribed to DeviceStore.onDeviceUpdated. (Inert today since WS updates aren't wired,
   * preserved verbatim for when they are.)
   */
  private hotSwapDetailPanel(updatedDevice: Device): void {
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

          const newPanel = this.createDetailPanel(updatedDevice, currentPos, false)

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

  /**
   * Construct a DeviceDetailPanel from this component's configured inputs.
   * `withAudio` mirrors the original call sites: the pin flow wires the interaction sounds,
   * the hot-swap flow does not.
   */
  private createDetailPanel(device: Device, worldPos: vec3, withAudio: boolean): DeviceDetailPanel {
    const apiUrlBase = HttpClient.deriveBaseUrl(this.websocketUrl)
    return new DeviceDetailPanel(this.sceneObject, this.layer, this.cameraRoot, device, worldPos, {
      indicatorPrefab: this.indicatorPrefab,
      indicatorMaterial: this.indicatorMaterial,
      tripleMonitorPrefab: this.tripleMonitorPrefab,
      apiUrlBase: apiUrlBase,
      shellTerminalPrefab: this.shellTerminalPrefab,
      notebookPrefab: this.notebookPrefab,
      analyzeAudio: withAudio ? this.analyzeAudio : undefined,
      openAudio: withAudio ? this.openAudio : undefined,
      selectAudio: withAudio ? this.selectAudio : undefined
    })
  }
}
