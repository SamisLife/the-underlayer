/**
 * DeviceDetailPanel.ts
 * The expanded AR device card: a holographic triple-monitor view built procedurally and anchored in
 * world space. Renders the vulnerability breakdown, the radar threat chart, network/open ports,
 * AI-generated action items with FIX-approval popups, the "analyzing" animation, and the AI tutor
 * notebook. Talks to the backend through the injected DeviceDataSourceProvider (live vs demo).
 */

import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {TargetingMode} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {Device, DeviceSummary, OpenPort} from "./Data/DeviceTypes"
import {DeviceDataSourceProvider} from "./Services/DeviceDataSourceProvider"
import {
  C_CYAN,
  C_WHITE,
  FS_TITLE,
  FS_BODY,
  FS_SMALL,
  FS_TINY,
  threatColor,
  priorityColor
} from "./UI/Theme"
import {makeObject, makeText, makePlate, configureButton, stripButtonVisual} from "./UI/UiBuilders"

/**
 * Construction options for DeviceDetailPanel. Built once by DeviceListPanel from asset inputs,
 * so the panel takes one named-and-checked object instead of positional scene references.
 * Scene/identity essentials (parent, layer, camera, device, world position) stay positional.
 */
export interface DeviceDetailPanelConfig {
  indicatorPrefab?: ObjectPrefab
  indicatorMaterial?: Material
  tripleMonitorPrefab?: ObjectPrefab
  apiUrlBase: string
  shellTerminalPrefab?: ObjectPrefab
  notebookPrefab?: ObjectPrefab
  analyzeAudio?: AudioComponent
  openAudio?: AudioComponent
  selectAudio?: AudioComponent
}

interface TripleMonitorLayout {
  baseCenterWidth: number
  baseCenterHeight: number
  baseCenterDepth: number
  baseSideWidth: number
  baseSideHeight: number
  baseSideDepth: number
  screenRecess: number
  sideAngle: number
  sideGap: number
  textScale: number
  centerScale: number
}

type ActionProblem = NonNullable<DeviceSummary["problems"]>[number]
type PortDisplayItem = OpenPort | number | string

const INDICATOR_PREFAB_SCALE = 7.0

const MONITOR_UI = {
  centerScale: 0.2,
  centerOffset: new vec3(0, 0, 0),
  centerRot: new vec3(0, 0, 0),
  leftScale: 0.2,
  leftOffset: new vec3(0, 0, 0),
  leftRot: new vec3(0, 0, 0),
  rightScale: 0.2,
  rightOffset: new vec3(0, 0, 0),
  rightRot: new vec3(0, 0, 0)
}

const SHELL_TERMINAL_UI = {
  scale: 0.03,
  offset: new vec3(-32.5, -14.0, 0.0)
}

const NOTEBOOK_UI = {
  scale: 0.16,
  offset: new vec3(-15.0, -8.0, 0.0),
  titlePos: new vec3(-3.5, 17.5, 2.0),
  textPos: new vec3(-4.0, -25.0, 2.0),
  closeBtnPos: new vec3(-13.0, 17.5, 2.0)
}

export class DeviceDetailPanel {
  private panelRoot: SceneObject
  private indicatorRoot: SceneObject
  private uiRoot: SceneObject
  private uiScaledRoot: SceneObject | null = null
  private indicatorBaseY: number = 15.0
  private dataSource = DeviceDataSourceProvider.getInstance()

  // Lifecycle guard so async (network/demo-delay) callbacks no-op after the panel is destroyed.
  private isDestroyed: boolean = false
  // Captured so the per-frame UpdateEvent can be removed on destroy (previously leaked).
  private updateScript?: ScriptComponent
  private updateEvent?: UpdateEvent

  // Configuration (assigned from the config object in the constructor).
  private indicatorPrefab?: ObjectPrefab
  private indicatorMaterial?: Material
  private tripleMonitorPrefab?: ObjectPrefab
  private apiUrlBase: string
  private shellTerminalPrefab?: ObjectPrefab
  private notebookPrefab?: ObjectPrefab
  public analyzeAudio?: AudioComponent
  public openAudio?: AudioComponent
  public selectAudio?: AudioComponent

  constructor(
    parentRoot: SceneObject,
    private layer: LayerSet,
    private cameraRoot: SceneObject,
    public device: Device,
    worldPos: vec3,
    config: DeviceDetailPanelConfig
  ) {
    this.indicatorPrefab = config.indicatorPrefab
    this.indicatorMaterial = config.indicatorMaterial
    this.tripleMonitorPrefab = config.tripleMonitorPrefab
    this.apiUrlBase = config.apiUrlBase
    this.shellTerminalPrefab = config.shellTerminalPrefab
    this.notebookPrefab = config.notebookPrefab
    this.analyzeAudio = config.analyzeAudio
    this.openAudio = config.openAudio
    this.selectAudio = config.selectAudio

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
    // 1. Minimized Indicator
    this.indicatorRoot = makeObject(this.panelRoot, this.layer, "Indicator_Root", new vec3(0, this.indicatorBaseY, 0))
    if (this.indicatorPrefab) {
      const indMesh = this.indicatorPrefab.instantiate(this.indicatorRoot)
      indMesh.getTransform().setLocalScale(new vec3(INDICATOR_PREFAB_SCALE, INDICATOR_PREFAB_SCALE, INDICATOR_PREFAB_SCALE))
      if (this.indicatorMaterial) this.applyMaterialRecursive(indMesh, this.indicatorMaterial)
    } else {
      makePlate(this.indicatorRoot, this.layer, "IndBg", new vec2(8.0, 8.0), vec3.zero(), new vec4(0.2, 0, 0, 0.8), 4.0, new vec4(1, 0, 0, 1), 0.5, 2.0)
      makeText(this.indicatorRoot, this.layer, "IndTxt", "<!>", FS_BODY, new vec4(1, 0.2, 0.2, 1), new vec3(0, 0, 0.2), 6.0, 6.0)
    }

    const indBtn = this.indicatorRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    indBtn.size = new vec3(10.0, 10.0, 10.0)
    indBtn.initialize()
    stripButtonVisual(indBtn)
    indBtn.onTriggerUp.add(() => {
      if (this.openAudio) {
        this.openAudio.play(1)
      }
      this.setExpanded(true)
    })

    // 2. Expanded UI (Triple Monitors)
    this.uiRoot = makeObject(this.panelRoot, this.layer, "UI_Root", new vec3(0, 15.0, 0))
    
    if (this.tripleMonitorPrefab) {
      this.meshObj = this.tripleMonitorPrefab.instantiate(this.uiRoot)
      
      // UI is parented to uiRoot (Y-up, +Z toward camera) not to meshObj, so it avoids
      // the FBX importer's -90° X correction and is never "sleeping on its back".
      // uiRoot world scale is ~1.0, so no invScale is needed; MONITOR_UI scale values
      // directly control the layout dimensions.
      this.uiScaledRoot = makeObject(this.uiRoot, this.layer, "UIScaledRoot", vec3.zero())
      this.buildTripleMonitors(this.uiScaledRoot)
    } else {
      // Fallback if prefab is missing
      makeText(this.uiRoot, this.layer, "Fallback", "TRIPLE MONITOR PREFAB MISSING", 24, C_WHITE, vec3.zero(), 40, 20)
    }

    // Bottom menu buttons
    const bottomMenu = makeObject(this.uiRoot, this.layer, "BottomMenu", new vec3(0, -20.0, 5.0))

    // Close Button
    const closeBtnRoot = makeObject(bottomMenu, this.layer, "CloseBtn", new vec3(-11.0, 0, 0))
    makeText(closeBtnRoot, this.layer, "CloseTxt", "X", FS_SMALL, new vec4(1,0,0,1), new vec3(0, 0, 0.2), 6.0, 6.0)
    const closeBtn = closeBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    closeBtn.size = new vec3(6.0, 6.0, 4.0)
    closeBtn.initialize()
    this.configureBtn(closeBtn, new vec4(0.2, 0.05, 0.05, 0.8), () => this.setExpanded(false))

    // Analyze Button
    const analyzeBtnRoot = makeObject(bottomMenu, this.layer, "AnalyzeBtn", new vec3(5.0, 0, 0))
    makeText(analyzeBtnRoot, this.layer, "AnalyzeTxt", "ANALYZE DEVICE", FS_SMALL, C_CYAN, new vec3(0, 0, 0.2), 22.0, 6.0)
    const analyzeBtn = analyzeBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    analyzeBtn.size = new vec3(22.0, 6.0, 4.0)
    analyzeBtn.initialize()
    this.configureBtn(analyzeBtn, new vec4(0, 0, 0, 0.8), () => this.triggerAnalysis(analyzeBtn, analyzeBtnRoot))

    this.updateScript = this.panelRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    this.updateEvent = this.updateScript.createEvent("UpdateEvent") as UpdateEvent
    this.updateEvent.bind(() => this.onUpdate())

    this.setExpanded(false)
  }

  private meshObj: SceneObject
  private orbitingNodes: SceneObject[] = []
  private isHighThreat: boolean = false
  private threatColor: vec4 = C_CYAN
  private threatLevel: string = "unknown"

  // Scanning Animation State
  private isAnalyzing: boolean = false
  private analysisStartTime: number = 0
  private analysisCompleted: boolean = false
  private dataTubes: SceneObject[] = []
  private dataChunks: { obj: SceneObject, tubeIndex: number, progress: number, text: Text }[] = []
  
  // To preserve original resting positions for jitter
  private baseCenterUIPos: vec3 = vec3.zero()
  private baseLeftUIPos: vec3 = vec3.zero()
  private baseRightUIPos: vec3 = vec3.zero()
  
  private centerRoot?: SceneObject
  private leftRoot?: SceneObject
  private rightRoot?: SceneObject

  public updateDeviceData(device: Device): void {
    this.device = device
    if (this.uiScaledRoot) {
      // Clean up old UI elements
      const count = this.uiScaledRoot.getChildrenCount()
      for (let i = count - 1; i >= 0; i--) {
        this.uiScaledRoot.getChild(i).destroy()
      }
      this.orbitingNodes = []
      this.buildTripleMonitors(this.uiScaledRoot)
    }
  }

  private buildTripleMonitors(scaledRoot: SceneObject): void {
    const tLevel = this.device.ar_summary?.threatLevel || "unknown"
    this.threatLevel = tLevel
    const tColor = threatColor(tLevel)
    this.threatColor = tColor
    this.isHighThreat = tLevel === "high" || tLevel === "critical"

    const layout: TripleMonitorLayout = {
      baseCenterWidth: 340,
      baseCenterHeight: 145,
      baseCenterDepth: 28,
      baseSideWidth: 240,
      baseSideHeight: 145,
      baseSideDepth: 24,
      screenRecess: 2.5,
      sideAngle: 35 * Math.PI / 180,
      sideGap: 4,
      textScale: 4.5,
      centerScale: MONITOR_UI.centerScale
    }

    const cves = this.device.ar_summary?.cveCount || 0
    const ports = this.device.ar_summary?.openPorts || []
    const problems = this.device.ar_summary?.problems || []

    this.buildCenterMonitor(scaledRoot, layout, tLevel, tColor, cves)
    this.buildRightMonitor(scaledRoot, layout, tColor, cves, ports, problems)
    this.buildLeftMonitor(scaledRoot, layout, ports, problems)
  }

  private buildCenterMonitor(
    scaledRoot: SceneObject,
    layout: TripleMonitorLayout,
    tLevel: string,
    tColor: vec4,
    cves: number
  ): void {
    const SC_C = layout.centerScale
    const c_w = layout.baseCenterWidth * SC_C
    const c_h = layout.baseCenterHeight * SC_C
    const c_d = layout.baseCenterDepth * SC_C
    const TS = layout.textScale

    const c_z_face = (c_d / 2) - (layout.screenRecess * SC_C) + (2.0 * SC_C)
    const centerBasePos = new vec3(0, 0, c_z_face)
    const centerPos = new vec3(
      centerBasePos.x + MONITOR_UI.centerOffset.x,
      centerBasePos.y + MONITOR_UI.centerOffset.y,
      centerBasePos.z + MONITOR_UI.centerOffset.z
    )
    const centerRoot = makeObject(scaledRoot, this.layer, "CenterMonitor", centerPos)
    centerRoot.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(
      MONITOR_UI.centerRot.x * Math.PI/180,
      MONITOR_UI.centerRot.y * Math.PI/180,
      MONITOR_UI.centerRot.z * Math.PI/180
    )))

    this.centerRoot = centerRoot
    this.baseCenterUIPos = centerPos

    this.dataTubes = []
    this.dataChunks = []
    for (let i = 0; i < 3; i++) {
      const tubeRoot = makeObject(centerRoot, this.layer, `DataTube_${i}`, vec3.zero())

      const segments = 15
      let prevPos = this.getTubeCurve(i, 0, SC_C, c_h)
      for (let s = 1; s <= segments; s++) {
        const t = s / segments
        const curPos = this.getTubeCurve(i, t, SC_C, c_h)
        this.makeLine3D(tubeRoot, `WireSeg_${s}`, prevPos, curPos, 6.0 * SC_C, new vec4(0, 1, 1, 0.2))
        prevPos = curPos
      }

      this.dataTubes.push(tubeRoot)

      const chunkRoot = makeObject(tubeRoot, this.layer, `Chunk_${i}`, vec3.zero())
      chunkRoot.enabled = false
      const txt = makeText(chunkRoot, this.layer, `ChunkTxt_${i}`, "0101", FS_BODY * SC_C * TS, C_CYAN, vec3.zero(), 30 * SC_C * TS, 10 * SC_C * TS)
      this.dataChunks.push({ obj: chunkRoot, tubeIndex: i, progress: Math.random(), text: txt })
    }

    const displayName = this.device.bt_name || this.device.hostname || "UNKNOWN"
    makeText(centerRoot, this.layer, "Header", `> ${displayName}_`, (FS_TITLE * 1.75) * SC_C * TS, C_WHITE, new vec3(0, c_h/2 - (35 * SC_C), 0), (c_w - (20 * SC_C)) * TS, 60 * SC_C * TS)
    makeText(centerRoot, this.layer, "SubHeader", `TOTAL CVE: ${cves} | THREAT: ${tLevel.toUpperCase()}`, (FS_SMALL * 1.75) * SC_C * TS, tColor, new vec3(0, c_h/2 - (65 * SC_C), 0), (c_w - (20 * SC_C)) * TS, 40 * SC_C * TS)

    const counts = this.device.ar_summary?.sourceCounts || {}
    let totalVulns = 0
    for (const count of Object.values(counts)) {
      totalVulns += count
    }

    let yOffset = c_h/2 - (95 * SC_C)
    if (totalVulns === 0) {
      if (this.device.ar_summary?.scanMetadata?.ssh_status === "queued") {
        makeText(centerRoot, this.layer, "NoVulns", "GRABBING INFORMATION FROM SSH...", FS_SMALL * SC_C * TS, new vec4(1, 0.6, 0, 1), new vec3(0, yOffset, 0), (c_w - (40 * SC_C)) * TS, 20 * SC_C * TS)
      } else {
        makeText(centerRoot, this.layer, "NoVulns", "SYSTEM SECURE. NO VULNERABILITIES DETECTED.", FS_SMALL * SC_C * TS, C_CYAN, new vec3(0, yOffset, 0), (c_w - (40 * SC_C)) * TS, 20 * SC_C * TS)
      }
    } else {
      for (const [src, count] of Object.entries(counts)) {
        const maxW = c_w - (160 * SC_C)
        const w = Math.min((count / totalVulns) * maxW, maxW)
        const labelW = 80 * SC_C * TS
        const valW = 40 * SC_C * TS
        makeText(centerRoot, this.layer, `Txt_${src}`, `> ${src}:`, FS_SMALL * SC_C * TS, C_CYAN, new vec3(-c_w/2 + (50 * SC_C) + labelW/2, yOffset, 0), labelW, 20 * SC_C * TS, HorizontalAlignment.Left)
        makePlate(centerRoot, this.layer, `Bar_${src}`, new vec2(w, 6 * SC_C), new vec3(-c_w/2 + (100 * SC_C) + w/2, yOffset, 0), tColor, 2 * SC_C, undefined, 0, 0)
        makeText(centerRoot, this.layer, `Val_${src}`, `${count}`, FS_SMALL * SC_C * TS, C_WHITE, new vec3(-c_w/2 + (115 * SC_C) + w + valW/2, yOffset, 0), valW, 20 * SC_C * TS, HorizontalAlignment.Left)
        yOffset -= (5 * SC_C * TS)
      }
    }
  }

  private buildRightMonitor(
    scaledRoot: SceneObject,
    layout: TripleMonitorLayout,
    tColor: vec4,
    cves: number,
    ports: PortDisplayItem[],
    problems: ActionProblem[]
  ): void {
    const SC_C = layout.centerScale
    const SC_R = MONITOR_UI.rightScale
    const TS = layout.textScale
    const r_s_w = layout.baseSideWidth * SC_R
    const r_s_h = layout.baseSideHeight * SC_R
    const r_s_d = layout.baseSideDepth * SC_R

    const r_s_z_face = (r_s_d / 2) - (layout.screenRecess * SC_R) + (0.1 * SC_R)
    const r_pivot_x = (layout.baseCenterWidth / 2 + layout.sideGap) * SC_C
    const rightPivot = makeObject(scaledRoot, this.layer, "RightPivot", new vec3(r_pivot_x, 0, 0))
    rightPivot.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(0, -layout.sideAngle, 0)))

    const rBasePos = new vec3(r_s_w / 2, 0, r_s_z_face)
    const rightPos = new vec3(rBasePos.x + MONITOR_UI.rightOffset.x, rBasePos.y + MONITOR_UI.rightOffset.y, rBasePos.z + MONITOR_UI.rightOffset.z)
    const rightRoot = makeObject(rightPivot, this.layer, "RightMonitor", rightPos)
    rightRoot.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(
      MONITOR_UI.rightRot.x * Math.PI/180,
      MONITOR_UI.rightRot.y * Math.PI/180,
      MONITOR_UI.rightRot.z * Math.PI/180
    )))

    this.rightRoot = rightRoot
    this.baseRightUIPos = rightPos

    if (problems.length > 3) {
      this.buildActionItems(rightRoot, "R_Header", "ACTION ITEMS (CONT.)", problems, 3, Math.min(problems.length, 6), SC_R, r_s_w, r_s_h, TS)
    } else {
      makeText(rightRoot, this.layer, "R_Header", "THREAT ANALYSIS", FS_SMALL * SC_R * TS, C_CYAN, new vec3(0, r_s_h/2 - (10 * SC_R), 0), (r_s_w - (20 * SC_R)) * TS, 20 * SC_R * TS)
      this.buildRadarChart(rightRoot, SC_R, tColor, cves, ports, TS)
    }
  }

  private buildRadarChart(
    rightRoot: SceneObject,
    scale: number,
    tColor: vec4,
    cves: number,
    ports: PortDisplayItem[],
    textScale: number
  ): void {
    const radarRoot = makeObject(rightRoot, this.layer, "Radar", new vec3(0, -10 * scale, 0))
    const numAxes = 5
    const radius = 35 * scale
    const labels = ["DENSITY", "NETWORK", "PRIVESC", "OS", "CONFIG"]
    const os = this.device.ar_summary?.os?.toLowerCase() || "unknown"
    const pScore = ports.length > 5 ? 1.0 : (ports.length / 5.0)
    const cScore = Math.min(1.0, cves / 50.0)
    const oScore = os.includes("windows") ? 0.8 : (os.includes("linux") ? 0.5 : 0.3)
    const scores = [cScore, pScore, this.isHighThreat ? 0.9 : 0.4, oScore, 0.6]

    const dataPts: vec3[] = []
    for (let i = 0; i < numAxes; i++) {
      const a = Math.PI / 2 - (Math.PI * 2 * i) / numAxes
      const pt = new vec3(Math.cos(a) * radius * scores[i], Math.sin(a) * radius * scores[i], 0)
      dataPts.push(pt)

      const labelOffset = 26 * scale
      const lp = new vec3(Math.cos(a) * (radius + labelOffset), Math.sin(a) * (radius + labelOffset), 0)

      const labelRoot = makeObject(radarRoot, this.layer, `LblRoot_${i}`, lp)
      const labelVis = makeObject(labelRoot, this.layer, `LblVis_${i}`, vec3.zero())
      makeText(labelVis, this.layer, `Lbl_${i}`, labels[i], FS_BODY * scale * textScale, tColor, vec3.zero(), 120 * scale * textScale, 40 * scale * textScale, HorizontalAlignment.Center)

      const qTxtR = makeText(labelVis, this.layer, `QTxt_${i}`, "?", FS_TITLE * scale * textScale, C_CYAN, new vec3(25 * scale, 8 * scale, 0.5), 20 * scale * textScale, 20 * scale * textScale, HorizontalAlignment.Center, 35)
      qTxtR.enabled = false

      const collider = labelRoot.createComponent("Physics.ColliderComponent") as ColliderComponent
      collider.fitVisual = false
      const boxShape = Shape.createBoxShape()
      boxShape.size = new vec3(35.0 * scale, 15.0 * scale, 2.0)
      collider.shape = boxShape

      const interactable = labelRoot.createComponent(Interactable.getTypeName()) as Interactable
      interactable.targetingMode = TargetingMode.All

      interactable.onHoverEnter.add(() => {
        qTxtR.enabled = true
        labelVis.getTransform().setLocalPosition(new vec3(0, 0, 10.0))
      })

      interactable.onHoverExit.add(() => {
        qTxtR.enabled = false
        labelVis.getTransform().setLocalPosition(vec3.zero())
      })

      const ctxStr = `You are an AI embedded in an AR cybersecurity dashboard. Briefly explain what the threat analysis metric '${labels[i]}' means in the context of a cyber spider-web threat analysis diagram. The current target device is ${this.device.hostname} (OS: ${os}). Keep it concise and highly relevant to an active AR cyber operation.`
      interactable.onTriggerEnd.add(() => {
        if (this.selectAudio) this.selectAudio.play(1)
        this.showNotebook(`METRIC: ${labels[i]}`, ctxStr)
      })

      this.makeLine(radarRoot, `Axis_${i}`, vec3.zero(), new vec3(Math.cos(a) * radius, Math.sin(a) * radius, 0), 0.5 * scale, new vec4(0, 1, 0.8, 0.4))
    }

    const numSteps = 5
    for (let step = 1; step <= numSteps; step++) {
      const rStep = radius * (step / numSteps)
      for (let i = 0; i < numAxes; i++) {
        const a1 = Math.PI / 2 - (Math.PI * 2 * i) / numAxes
        const a2 = Math.PI / 2 - (Math.PI * 2 * ((i + 1) % numAxes)) / numAxes

        const pt1 = new vec3(Math.cos(a1) * rStep, Math.sin(a1) * rStep, 0)
        const pt2 = new vec3(Math.cos(a2) * rStep, Math.sin(a2) * rStep, 0)

        this.makeLine(radarRoot, `Grid_${step}_${i}`, pt1, pt2, 0.3 * scale, new vec4(0, 1, 0.8, 0.2))
      }
    }

    for (let i = 0; i < numAxes; i++) {
      this.makeLine(radarRoot, `Data_${i}`, dataPts[i], dataPts[(i + 1) % numAxes], 2.0 * scale, tColor)
    }
  }

  private buildLeftMonitor(
    scaledRoot: SceneObject,
    layout: TripleMonitorLayout,
    ports: PortDisplayItem[],
    problems: ActionProblem[]
  ): void {
    const SC_C = layout.centerScale
    const SC_L = MONITOR_UI.leftScale
    const TS = layout.textScale
    const l_s_w = layout.baseSideWidth * SC_L
    const l_s_h = layout.baseSideHeight * SC_L
    const l_s_d = layout.baseSideDepth * SC_L

    const l_s_z_face = (l_s_d / 2) - (layout.screenRecess * SC_L) + (0.1 * SC_L)
    const l_pivot_x = (layout.baseCenterWidth / 2 + layout.sideGap) * SC_C
    const leftPivot = makeObject(scaledRoot, this.layer, "LeftPivot", new vec3(-l_pivot_x, 0, 0))
    leftPivot.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(0, layout.sideAngle, 0)))

    const lBasePos = new vec3(-l_s_w / 2, 0, l_s_z_face)
    const leftPos = new vec3(lBasePos.x + MONITOR_UI.leftOffset.x, lBasePos.y + MONITOR_UI.leftOffset.y, lBasePos.z + MONITOR_UI.leftOffset.z)
    const leftRoot = makeObject(leftPivot, this.layer, "LeftMonitor", leftPos)
    leftRoot.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(
      MONITOR_UI.leftRot.x * Math.PI/180,
      MONITOR_UI.leftRot.y * Math.PI/180,
      MONITOR_UI.leftRot.z * Math.PI/180
    )))

    this.leftRoot = leftRoot
    this.baseLeftUIPos = leftPos

    if (problems.length > 0) {
      this.buildActionItems(leftRoot, "L_Header", "ACTION ITEMS", problems, 0, Math.min(problems.length, 3), SC_L, l_s_w, l_s_h, TS)
    } else {
      this.buildNetworkDiagnostics(leftRoot, SC_L, l_s_w, l_s_h, ports, TS)
    }
  }

  private buildActionItems(
    root: SceneObject,
    headerName: string,
    title: string,
    problems: ActionProblem[],
    startIndex: number,
    endIndex: number,
    scale: number,
    monitorWidth: number,
    monitorHeight: number,
    textScale: number
  ): void {
    makeText(root, this.layer, headerName, title, FS_SMALL * scale * textScale, C_CYAN, new vec3(0, monitorHeight/2 - (15 * scale), 0), (monitorWidth - (20 * scale)) * textScale, 20 * scale * textScale)

    let pY = monitorHeight/2 - (40 * scale)
    for (let i = startIndex; i < endIndex; i++) {
      this.buildActionItemRow(root, problems[i], i, scale, monitorWidth, pY, textScale)
      pY -= (35 * scale)
    }
  }

  private buildNetworkDiagnostics(
    leftRoot: SceneObject,
    scale: number,
    monitorWidth: number,
    monitorHeight: number,
    ports: PortDisplayItem[],
    textScale: number
  ): void {
    makeText(leftRoot, this.layer, "L_Header", "NETWORK DIAGNOSTICS", FS_SMALL * scale * textScale, C_CYAN, new vec3(0, monitorHeight/2 - (25 * scale), 0), (monitorWidth - (20 * scale)) * textScale, 20 * scale * textScale)

    const C_GREEN = new vec4(0.2, 1.0, 0.2, 1.0)
    const C_ORANGE = new vec4(1.0, 0.5, 0.0, 1.0)
    const C_RED = new vec4(1.0, 0.2, 0.2, 1.0)

    const netCenter = makeObject(leftRoot, this.layer, "NetCenter", new vec3(0, -10 * scale, 0))

    makeText(netCenter, this.layer, "L_PortsLabel", "OPEN PORTS", FS_SMALL * scale * textScale, C_RED, new vec3(0, 12 * scale, 0), 100 * scale * textScale, 20 * scale * textScale, HorizontalAlignment.Center)
    makeText(netCenter, this.layer, "NetIcon", "[ NETWORK ]", FS_SMALL * scale * textScale, C_WHITE, vec3.zero(), 100 * scale * textScale, 20 * scale * textScale)

    const numPorts = Math.min(ports.length, 6)
    if (numPorts === 0) {
      makeText(leftRoot, this.layer, "L_Ports", `PORTS: NONE`, FS_TINY * scale * textScale, C_ORANGE, new vec3(0, monitorHeight/2 - (75 * scale), 0), (monitorWidth - (20 * scale)) * textScale, 15 * scale * textScale)
    } else {
      const r = 45.0 * scale
      for (let i = 0; i < numPorts; i++) {
        const a = (Math.PI * 2 * i) / numPorts
        const px = Math.cos(a) * r
        const py = Math.sin(a) * r

        const p = ports[i]
        const pVal = typeof p === "object" ? p.port : p
        const commonPorts: Record<string, string> = {
          "22": "ssh", "80": "http", "443": "https", "3000": "node", "5000": "flask", "8080": "http-alt", "3306": "mysql", "5432": "postgres", "21": "ftp", "23": "telnet", "25": "smtp", "3389": "rdp", "5900": "vnc"
        }
        const pStr = pVal.toString()
        const portStr = commonPorts[pStr] ? `${pStr}\n(${commonPorts[pStr]})` : pStr

        const portRoot = makeObject(netCenter, this.layer, `PortRoot_${i}`, new vec3(px, py, 0))
        const portVis = makeObject(portRoot, this.layer, `PortVis_${i}`, vec3.zero())
        makeText(portVis, this.layer, `PortTxt_${i}`, portStr, FS_SMALL * scale * textScale, C_GREEN, vec3.zero(), 80 * scale * textScale, 40 * scale * textScale, HorizontalAlignment.Center)

        const qTxt = makeText(portVis, this.layer, `QTxt_${i}`, "?", FS_TITLE * scale * textScale, C_CYAN, new vec3(12 * scale, 8 * scale, 0.5), 20 * scale * textScale, 20 * scale * textScale, HorizontalAlignment.Center, 35)
        qTxt.enabled = false

        const collider = portRoot.createComponent("Physics.ColliderComponent") as ColliderComponent
        collider.fitVisual = false
        const boxShape = Shape.createBoxShape()
        boxShape.size = new vec3(15.0, 15.0, 2.0)
        collider.shape = boxShape

        const interactable = portRoot.createComponent(Interactable.getTypeName()) as Interactable
        interactable.targetingMode = TargetingMode.All

        interactable.onHoverEnter.add(() => {
          qTxt.enabled = true
          portVis.getTransform().setLocalPosition(new vec3(0, 0, 10.0))
        })

        interactable.onHoverExit.add(() => {
          qTxt.enabled = false
          portVis.getTransform().setLocalPosition(vec3.zero())
        })

        interactable.onTriggerEnd.add(() => {
          if (this.selectAudio) this.selectAudio.play(1)
          this.showNotebook(`Port ${pStr}`, this.buildPortLearningContext(p, pStr))
        })

        this.makeLine(netCenter, `PLine_${i}`, vec3.zero(), new vec3(px, py, 0), 0.5 * scale, new vec4(1, 0.2, 0.2, 0.3))
      }
    }

    for (let i = 0; i < 6; i++) {
      const node = makeObject(netCenter, this.layer, `Node_${i}`, vec3.zero())
      makePlate(node, this.layer, `NodePlt_${i}`, new vec2(6 * scale, 6 * scale), vec3.zero(), new vec4(1.0, 0.2, 0.2, 1.0), 1.0 * scale, undefined, 0, 0)
      this.orbitingNodes.push(node)
    }
  }

  private buildPortLearningContext(port: PortDisplayItem, portNumber: string): string {
    const summary = this.device.ar_summary
    const service = typeof port === "object" ? port.service : undefined
    const risk = typeof port === "object" ? port.risk : undefined
    const note = typeof port === "object" ? port.note : undefined

    const details = [
      `Open port ${portNumber} on ${this.device.hostname}.`,
      service ? `Service: ${service}.` : "",
      risk ? `Risk: ${risk}.` : "",
      note ? `Note: ${note}.` : "",
      summary?.os ? `Device OS: ${summary.os}.` : "",
      summary?.threatLevel ? `Current threat level: ${summary.threatLevel}.` : "",
      summary?.cveCount !== undefined ? `Known CVE count: ${summary.cveCount}.` : ""
    ]

    return details.filter((part) => part !== "").join(" ")
  }

  private buildActionItemRow(
    root: SceneObject,
    problem: ActionProblem,
    index: number,
    scale: number,
    monitorWidth: number,
    yPosition: number,
    textScale: number
  ): void {
    const pColor = priorityColor(problem.priority)
    const textW = (monitorWidth - (70 * scale)) * textScale
    const startX = -monitorWidth / 2 + (15 * scale)
    const posX = startX + textW / 2

    makeText(
      root,
      this.layer,
      `Prob_${index}`,
      `[${problem.priority}] ${problem.description}`,
      FS_SMALL * scale * textScale,
      pColor,
      new vec3(posX, yPosition, 0),
      textW,
      16 * scale * textScale,
      HorizontalAlignment.Left
    )

    const fixBtnRoot = makeObject(
      root,
      this.layer,
      `FixBtn_${index}`,
      new vec3((monitorWidth / 2) - (28 * scale), yPosition - (6 * scale), 0)
    )
    makeText(
      fixBtnRoot,
      this.layer,
      "Txt",
      "FIX",
      FS_SMALL * scale * textScale,
      C_WHITE,
      new vec3(0, 0, 0.2),
      16 * scale * textScale,
      8 * scale * textScale
    )

    const fixBtn = fixBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    fixBtn.size = new vec3(20 * scale, 10 * scale, 2.0)
    fixBtn.initialize()
    this.configureBtn(
      fixBtn,
      new vec4(pColor.r * 0.5, pColor.g * 0.5, pColor.b * 0.5, 0.8),
      () => this.showFixPopup(problem)
    )
  }

  private triggerAnalysis(btn: RectangleButton, root: SceneObject): void {
    if (!this.apiUrlBase && this.dataSource.isLive) return
    btn.enabled = false
    const txt = root.getChild(0).getComponent("Component.Text") as Text
    if (txt) txt.text = "ANALYZING..."

    this.isAnalyzing = true
    this.analysisStartTime = getTime()
    this.analysisCompleted = false

    if (this.analyzeAudio) {
      this.analyzeAudio.play(1)
    }

    this.dataSource.analyze(this.device).then((result) => {
      if (this.isDestroyed) return
      if (this.analyzeAudio) this.analyzeAudio.stop(false)
      this.analysisCompleted = true
      btn.enabled = true

      if (!result.ok) {
        if (txt) txt.text = result.reason === "failed" ? "ANALYSIS FAILED" : "ERROR"
        return
      }

      if (txt) txt.text = "ANALYSIS COMPLETE"
      if (result.device) {
        // Force the UI to rebuild and render the newly discovered Action Items
        this.updateDeviceData(result.device)
      }
    })
  }

  private showFixPopup(problem: ActionProblem): void {
    // Dim the main UI to focus on popup
    this.uiRoot.enabled = false

    const popupRoot = makeObject(this.panelRoot, this.layer, "FixPopup", new vec3(0, 30.0, 20.0))
    let approveBtnRoot: SceneObject
    let approveBtn: RectangleButton
    let rejectBtnRoot: SceneObject
    let rejectBtn: RectangleButton

    if (this.shellTerminalPrefab) {
      const terminalInstance = this.shellTerminalPrefab.instantiate(popupRoot)
      
      // Apply the user-defined configurable parameters from Lens Studio properties!
      terminalInstance.getTransform().setLocalPosition(SHELL_TERMINAL_UI.offset)
      terminalInstance.getTransform().setLocalScale(new vec3(SHELL_TERMINAL_UI.scale, SHELL_TERMINAL_UI.scale, SHELL_TERMINAL_UI.scale))
      
      const C_GLOW_GREEN = new vec4(0.0, 1.0, 0.25, 1.0)
      const C_GLOW_DIM = new vec4(0.0, 0.6, 0.15, 1.0)
      
      // Position the text next to the prompt (estimated based on user request)
      // User says: "position it just after the username like a real terminal"
      // Both lines must share the exact same X coordinate (5.0) to mathematically match the terminal's physical prompt alignment.
      // We also pass `30, true` at the end to enable word wrapping, and increase the height bounds so wrapped lines don't get vertically truncated!
      makeText(popupRoot, this.layer, "Desc", `# ${problem.description}`, FS_BODY, C_GLOW_DIM, new vec3(5.0, 12.0, 2.0), 60.0, 25.0, HorizontalAlignment.Left, 30, true)
      makeText(popupRoot, this.layer, "Cmd", `${problem.fixCommand}`, FS_TITLE * 1.5, C_GLOW_GREEN, new vec3(5.0, 5.0, 2.0), 70.0, 30.0, HorizontalAlignment.Left, 30, true)

      approveBtnRoot = makeObject(popupRoot, this.layer, "ApproveBtn", new vec3(15.0, -28.0, 2.0))
      makeText(approveBtnRoot, this.layer, "ATxt", "[ Y ] APPROVE", FS_BODY, C_GLOW_GREEN, new vec3(0,0,0.2), 25.0, 8.0)
      approveBtn = approveBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
      approveBtn.size = new vec3(25.0, 10.0, 4.0)
      approveBtn.initialize()
      
      rejectBtnRoot = makeObject(popupRoot, this.layer, "RejectBtn", new vec3(-15.0, -28.0, 2.0))
      makeText(rejectBtnRoot, this.layer, "RTxt", "[ N ] REJECT", FS_BODY, C_GLOW_GREEN, new vec3(0,0,0.2), 25.0, 8.0)
      rejectBtn = rejectBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
      rejectBtn.size = new vec3(25.0, 10.0, 4.0)
      rejectBtn.initialize()
    } else {
      // Background Plate
      makePlate(popupRoot, this.layer, "Bg", new vec2(50.0, 30.0), vec3.zero(), new vec4(0, 0, 0, 0.95), 5.0, C_CYAN, 0.5, 0)
      
      // Text contents
      makeText(popupRoot, this.layer, "Header", "REQUIRE APPROVAL", FS_BODY, new vec4(1,0,0,1), new vec3(0, 10.0, 0.5), 45.0, 10.0)
      makeText(popupRoot, this.layer, "Desc", problem.description, FS_SMALL, C_WHITE, new vec3(0, 2.0, 0.5), 45.0, 20.0)
      makeText(popupRoot, this.layer, "Cmd", `> ${problem.fixCommand}`, FS_SMALL, C_CYAN, new vec3(0, -6.0, 0.5), 45.0, 10.0)

      // APPROVE Button
      approveBtnRoot = makeObject(popupRoot, this.layer, "ApproveBtn", new vec3(10.0, -12.0, 0.5))
      makeText(approveBtnRoot, this.layer, "ATxt", "APPROVE", FS_SMALL, C_WHITE, new vec3(0,0,0.2), 15.0, 6.0)
      approveBtn = approveBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
      approveBtn.size = new vec3(15.0, 6.0, 4.0)
      approveBtn.initialize()
      
      // REJECT Button
      rejectBtnRoot = makeObject(popupRoot, this.layer, "RejectBtn", new vec3(-10.0, -12.0, 0.5))
      makeText(rejectBtnRoot, this.layer, "RTxt", "REJECT", FS_SMALL, C_WHITE, new vec3(0,0,0.2), 15.0, 6.0)
      rejectBtn = rejectBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
      rejectBtn.size = new vec3(15.0, 6.0, 4.0)
      rejectBtn.initialize()
    }

    const closePopup = () => {
      popupRoot.destroy()
      this.uiRoot.enabled = true
    }

    this.configureBtn(rejectBtn, new vec4(0.3, 0.1, 0.1, 0.8), closePopup)

    this.configureBtn(approveBtn, new vec4(0.1, 0.4, 0.1, 0.8), () => {
      approveBtn.enabled = false
      const txt = approveBtnRoot.getChild(0).getComponent("Component.Text") as Text
      if (txt) txt.text = "EXECUTING..."

      this.dataSource.approveAction({
        hostname: this.device.hostname,
        actionLabel: problem.fixLabel || "FIX",
        command: problem.fixCommand
      }).then((result) => {
        if (this.isDestroyed) return

        if (!result.ok) {
          if (txt) txt.text = result.reason === "failed" ? "FAILED" : "ERROR"
          approveBtn.enabled = true
          return
        }

        if (txt) txt.text = "SUCCESS"

        if (this.dataSource.isLive) {
          // Live: after a beat, remove the problem locally and slide the next one up.
          this.delayOn(popupRoot, 2.0, () => {
            if (this.device.ar_summary && this.device.ar_summary.problems) {
              const idx = this.device.ar_summary.problems.indexOf(problem)
              if (idx > -1) {
                this.device.ar_summary.problems.splice(idx, 1)
              }
            }
            closePopup()
            // Refresh device to visually slide up the next problem
            this.updateDeviceData(this.device)
          })
        } else {
          // Demo: show SUCCESS briefly, then close (no local mutation).
          this.delayOn(popupRoot, 1.0, closePopup)
        }
      })
    })
  }

  private notebookRoot: SceneObject | null = null;

  public showNotebook(topic: string, contextStr?: string): void {
    if (this.notebookRoot) {
      this.notebookRoot.destroy();
      this.notebookRoot = null;
    }

    // Hide monitors
    if (this.uiRoot) this.uiRoot.enabled = false;

    // Placed lower to eye level
    this.notebookRoot = makeObject(this.panelRoot, this.layer, "NotebookRoot", new vec3(0, 0.0, 20.0));
    let uiNode = this.notebookRoot;

    if (this.notebookPrefab) {
      const nbInstance = this.notebookPrefab.instantiate(this.notebookRoot);
      nbInstance.getTransform().setLocalPosition(NOTEBOOK_UI.offset);
      nbInstance.getTransform().setLocalScale(new vec3(NOTEBOOK_UI.scale, NOTEBOOK_UI.scale, NOTEBOOK_UI.scale));
      uiNode = makeObject(this.notebookRoot, this.layer, "NotebookUINode", vec3.zero());
    } else {
      makePlate(this.notebookRoot, this.layer, "Bg", new vec2(50.0, 40.0), vec3.zero(), new vec4(0, 0, 0, 0.95), 5.0, C_CYAN, 0.5, 0);
      uiNode = makeObject(this.notebookRoot, this.layer, "NotebookUINode", vec3.zero());
    }

    const C_GLOW_GREEN = new vec4(0.0, 1.0, 0.25, 1.0);
    
    // Position text in the exact same screen region as the Shell Terminal
    const titleTxt = makeText(uiNode, this.layer, "NTitle", `[ INFO: ${topic.toUpperCase()} ]`, FS_SMALL, C_GLOW_GREEN, NOTEBOOK_UI.titlePos, 22.0, 10.0, HorizontalAlignment.Center);
    
    // Height is 80.0. With VerticalAlignment.Top, text starts at y + (height/2).
    const bodyTxt = makeText(uiNode, this.layer, "NBody", "LOADING...", FS_SMALL, C_WHITE, NOTEBOOK_UI.textPos, 16.0, 80.0, HorizontalAlignment.Left, 30, true, VerticalAlignment.Top);

    // Minimalist, sophisticated close button at top-left
    const closeBtnRoot = makeObject(uiNode, this.layer, "NCloseBtn", NOTEBOOK_UI.closeBtnPos);
    
    // Explicit red circular background plate
    const bgPlate = makePlate(closeBtnRoot, this.layer, "CBg", new vec2(1.5, 1.5), new vec3(0, 0, 0.0), new vec4(0.8, 0.1, 0.1, 1.0), 30, undefined, 0, 0.75);
    
    // The "X" text (shifted slightly forward in Z to avoid clipping with the red plate)
    makeText(closeBtnRoot, this.layer, "CTxt", "X", FS_TINY, C_WHITE, new vec3(0, 0, 0.5), 10.0, 10.0);
    
    const closeBtn = closeBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton;
    closeBtn.size = new vec3(5.0, 5.0, 4.0);
    closeBtn.initialize();
    stripButtonVisual(closeBtn);

    // Manual Hover effects on our perfect circle
    closeBtn.onHoverEnter.add(() => { bgPlate.backgroundColor = new vec4(1.0, 0.3, 0.3, 1.0); });
    closeBtn.onHoverExit.add(() => { bgPlate.backgroundColor = new vec4(0.8, 0.1, 0.1, 1.0); });
    closeBtn.onTriggerUp.add(() => {
      if (this.selectAudio) this.selectAudio.play(1)
      if (this.notebookRoot) {
        this.notebookRoot.destroy();
        this.notebookRoot = null;
      }
      if (this.uiRoot) this.uiRoot.enabled = true;
    });

    if (!this.apiUrlBase && this.dataSource.isLive) {
      bodyTxt.text = "OFFLINE MODE";
      return;
    }

    this.dataSource.learn(topic, contextStr || "").then((info) => {
      if (this.isDestroyed) return;
      bodyTxt.text = info;
    });
  }

  private makeLine(parent: SceneObject, name: string, start: vec3, end: vec3, thickness: number, color: vec4): void {
    const diff = end.sub(start);
    const length = diff.length;
    if (length < 0.001) return;
    
    const mid = start.add(diff.uniformScale(0.5));
    const angle = Math.atan2(diff.y, diff.x);
    
    const lineRoot = makeObject(parent, this.layer, name, mid);
    lineRoot.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(0, 0, angle)));
    makePlate(lineRoot, this.layer, name + "_plt", new vec2(length, thickness), vec3.zero(), color, 10, undefined, 0, 0);
  }

  private makeLine3D(parent: SceneObject, name: string, start: vec3, end: vec3, thickness: number, color: vec4): void {
    const diff = end.sub(start);
    const length = diff.length;
    if (length < 0.001) return;
    
    const mid = start.add(diff.uniformScale(0.5));
    const lineRoot = makeObject(parent, this.layer, name, mid);
    
    // In full 3D, align the local X-axis with the direction vector
    const rot = quat.rotationFromTo(vec3.right(), diff.normalize());
    lineRoot.getTransform().setLocalRotation(rot);
    
    // Create an asterisk (*) cross section using 3 plates to give it a 3D cylindrical appearance
    for (let i = 0; i < 3; i++) {
      const pObj = makeObject(lineRoot, this.layer, `p_${i}`, vec3.zero());
      pObj.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(i * Math.PI / 3, 0, 0)));
      makePlate(pObj, this.layer, `plt_${i}`, new vec2(length, thickness), vec3.zero(), color, 10, undefined, 0, 0);
    }
  }

  // Calculate position along a natural 3D catenary (hanging wire) curve
  private getTubeCurve(tubeIndex: number, t: number, SC_C: number, c_h: number): vec3 {
    // Top anchor (attached to the bottom of the center monitor)
    const topX = (tubeIndex - 1) * 30 * SC_C
    const topY = -c_h/2 - (5 * SC_C)
    const topZ = -5 * SC_C
    
    // Bottom anchor (bundled inwards, slightly asymmetric for a natural wire look)
    const bottomXs = [-12 * SC_C, 0 * SC_C, 12 * SC_C]
    const bottomX = bottomXs[tubeIndex]
    const bottomY = -c_h/2 - (100 * SC_C)
    
    // Slightly varied Z anchors
    const bottomZs = [-35 * SC_C, -45 * SC_C, -30 * SC_C]
    const bottomZ = bottomZs[tubeIndex]
    
    // Control point for a natural droop that terminates exactly at the bottom point
    const ctrlXs = [-15 * SC_C, 2 * SC_C, 15 * SC_C]
    const ctrlX = ctrlXs[tubeIndex]
    // To prevent curving back up, we set the control Y to exactly the bottom Y. 
    // This makes the wire approach the bottom tangentially without sagging below it.
    const ctrlY = bottomY
    // Slight bow backwards in Z, also slightly asymmetric
    const ctrlZs = [-65 * SC_C, -75 * SC_C, -55 * SC_C]
    const ctrlZ = ctrlZs[tubeIndex]
    
    // Quadratic Bezier interpolation in full 3D
    const u = 1 - t
    const x = u * u * bottomX + 2 * u * t * ctrlX + t * t * topX
    const y = u * u * bottomY + 2 * u * t * ctrlY + t * t * topY
    const z = u * u * bottomZ + 2 * u * t * ctrlZ + t * t * topZ
    
    return new vec3(x, y, z)
  }

  /** Run a callback after `seconds`, hosted on the given SceneObject so it is cleaned up when
   *  that object is destroyed (e.g. closing a popup cancels its pending delays). */
  private delayOn(host: SceneObject, seconds: number, cb: () => void): void {
    const script = host.createComponent("Component.ScriptComponent") as ScriptComponent
    const ev = script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    ev.bind(cb)
    ev.reset(seconds)
  }

  private configureBtn(btn: RectangleButton, defaultColor: vec4, tapCallback: () => void): void {
    configureButton(btn, defaultColor, () => {
      if (this.selectAudio) this.selectAudio.play(1)
      tapCallback()
    })
  }

  public setExpanded(expanded: boolean): void {
    if (this.indicatorRoot) this.indicatorRoot.enabled = !expanded
    if (this.uiRoot) this.uiRoot.enabled = expanded

    // If closing monitors in Demo Mode, wipe the mock problems and rebuild the UI
    if (!expanded && !this.dataSource.isLive && this.device?.ar_summary?.problems) {
      this.device.ar_summary.problems = []
      this.updateDeviceData(this.device)
    }
  }

  public isExpanded(): boolean {
    return this.uiRoot ? this.uiRoot.enabled : false
  }

  public getWorldPosition(): vec3 {
    return this.panelRoot ? this.panelRoot.getTransform().getWorldPosition() : vec3.zero()
  }

  private onUpdate(): void {
    const time = getTime()

    if (this.indicatorRoot && this.indicatorRoot.enabled) {
      // Rotating beacon logic
      const rot = quat.angleAxis(time * 2.0, vec3.up())
      this.indicatorRoot.getTransform().setLocalRotation(rot)
      const hover = Math.sin(time * 3.0) * 2.0
      this.indicatorRoot.getTransform().setLocalPosition(new vec3(0, this.indicatorBaseY + hover, 0))
    }

    if (this.uiRoot && this.uiRoot.enabled) {
      const dt = getDeltaTime()
      
      // Scanning Phase Animations
      if (this.isAnalyzing) {
        // 1. Data Chunks ascending through the tubes
        for (const chunk of this.dataChunks) {
          chunk.obj.enabled = true
          chunk.progress += dt * 1.5 // Speed multiplier
          if (chunk.progress > 1.0) {
            chunk.progress -= 1.0
            chunk.text.text = Math.random() > 0.5 ? "0x" + Math.floor(Math.random()*65535).toString(16).toUpperCase() : (Math.random() > 0.5 ? "ACCESS" : "BREACH")
          }
          
          // Animate the chunk beautifully along the same Bezier curve used to draw the tube
          // The progress goes from 0 (bottom) to 1 (top)
          const SC_C = MONITOR_UI.centerScale
          const c_h = 145 * SC_C // BASE_c_h * SC_C
          const curvePos = this.getTubeCurve(chunk.tubeIndex, chunk.progress, SC_C, c_h)
          
          // Shift the chunk out slightly in Z so it rides "on top" of the flat tube geometry
          curvePos.z += 1.0 * SC_C
          
          chunk.obj.getTransform().setLocalPosition(curvePos)
          
          // Flicker color
          if (Math.random() > 0.8) {
            chunk.text.textFill.color = new vec4(1, 0.2, 0.2, 1) // Red glitch
          } else {
            chunk.text.textFill.color = C_CYAN // Normal cyan
          }
        }

        // 2. Micro-jitters on the roots
        if (this.centerRoot) this.centerRoot.getTransform().setLocalPosition(this.baseCenterUIPos.add(new vec3((Math.random()-0.5)*0.5, (Math.random()-0.5)*0.5, 0)))
        if (this.leftRoot) this.leftRoot.getTransform().setLocalPosition(this.baseLeftUIPos.add(new vec3((Math.random()-0.5)*2.0, (Math.random()-0.5)*2.0, 0)))
        if (this.rightRoot) this.rightRoot.getTransform().setLocalPosition(this.baseRightUIPos.add(new vec3((Math.random()-0.5)*2.0, (Math.random()-0.5)*2.0, 0)))

        // 3. Completion check (enforce minimum 2.5 second duration for the visual effect)
        if (this.analysisCompleted && (time - this.analysisStartTime) > 2.5) {
          this.isAnalyzing = false
          // Hide chunks and reset roots
          for (const chunk of this.dataChunks) chunk.obj.enabled = false
          if (this.centerRoot) this.centerRoot.getTransform().setLocalPosition(this.baseCenterUIPos)
          if (this.leftRoot) this.leftRoot.getTransform().setLocalPosition(this.baseLeftUIPos)
          if (this.rightRoot) this.rightRoot.getTransform().setLocalPosition(this.baseRightUIPos)
        }
      }

      // Base gentle float
      const floatY = Math.sin(time * 2.0) * 1.5
      this.uiRoot.getTransform().setLocalPosition(new vec3(0, 15.0 + floatY, 0))

      // Orbiting nodes on the Left Monitor
      for (let i = 0; i < this.orbitingNodes.length; i++) {
        const node = this.orbitingNodes[i];
        const offset = i * (Math.PI / 3);
        const t = time * 2.0 + offset;
        const r = 40.0 * MONITOR_UI.leftScale;
        node.getTransform().setLocalPosition(new vec3(Math.cos(t) * r, Math.sin(t) * r, 0));
      }
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

  public destroy(): void {
    this.isDestroyed = true

    // Stop the per-frame update loop so it can't fire on a destroyed panel.
    if (this.updateScript && this.updateEvent) {
      this.updateScript.removeEvent(this.updateEvent)
    }

    // Hide problems again when the monitor is closed in Demo Mode
    if (!this.dataSource.isLive && this.device?.ar_summary?.problems) {
      this.device.ar_summary.problems = []
    }

    if (this.panelRoot) {
      this.panelRoot.destroy()
    }
  }
}
