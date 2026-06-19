import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import {RoundedRectangleVisual} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual"
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {TargetingMode} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {Device, DemoState} from "./Data/DeviceTypes"
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
  makePlate,
  normalizeDevice
} from "./DeviceListPanel"

export class DeviceDetailPanel {
  private panelRoot: SceneObject
  private indicatorRoot: SceneObject
  private uiRoot: SceneObject
  private uiScaledRoot: SceneObject | null = null
  private indicatorBaseY: number = 15.0
  private internetModule: any = require("LensStudio:InternetModule")

  constructor(
    parentRoot: SceneObject,
    private layer: LayerSet,
    private cameraRoot: SceneObject,
    public device: Device,
    worldPos: vec3,
    private indicatorPrefab?: ObjectPrefab,
    private indicatorScale: number = 1.0,
    private indicatorMaterial?: Material,
    private tripleMonitorPrefab?: ObjectPrefab,
    private centerUIScale: number = 0.2,
    private centerUIOffset: vec3 = new vec3(0, 0, 0),
    private centerUIRot: vec3 = new vec3(0, 0, 0),
    private leftUIScale: number = 0.2,
    private leftUIOffset: vec3 = new vec3(0, 0, 0),
    private leftUIRot: vec3 = new vec3(0, 0, 0),
    private rightUIScale: number = 0.2,
    private rightUIOffset: vec3 = new vec3(0, 0, 0),
    private rightUIRot: vec3 = new vec3(0, 0, 0),
    private apiUrlBase: string = "",
    private shellTerminalPrefab?: ObjectPrefab,
    private shellTerminalScale: number = 0.02,
    private shellTerminalOffset: vec3 = new vec3(-15.0, -8.0, 0.0),
    private notebookPrefab?: ObjectPrefab,
    private notebookScale: number = 0.16,
    private notebookOffset: vec3 = new vec3(15.0, -8.0, 0.0),
    private notebookTitlePos: vec3 = new vec3(-3.5, 17.5, 2.0),
    private notebookTextPos: vec3 = new vec3(-4.0, -27.0, 2.0),
    private notebookCloseBtnPos: vec3 = new vec3(-20.0, 17.5, 2.0),
    public analyzeAudio?: AudioComponent,
    public openAudio?: AudioComponent,
    public selectAudio?: AudioComponent
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
    // 1. Minimized Indicator
    this.indicatorRoot = makeObject(this.panelRoot, this.layer, "Indicator_Root", new vec3(0, this.indicatorBaseY, 0))
    if (this.indicatorPrefab) {
      const indMesh = this.indicatorPrefab.instantiate(this.indicatorRoot)
      indMesh.getTransform().setLocalScale(new vec3(this.indicatorScale, this.indicatorScale, this.indicatorScale))
      if (this.indicatorMaterial) this.applyMaterialRecursive(indMesh, this.indicatorMaterial)
    } else {
      makePlate(this.indicatorRoot, this.layer, "IndBg", new vec2(8.0, 8.0), vec3.zero(), new vec4(0.2, 0, 0, 0.8), 4.0, new vec4(1, 0, 0, 1), 0.5, 2.0)
      makeText(this.indicatorRoot, this.layer, "IndTxt", "<!>", FS_BODY, new vec4(1, 0.2, 0.2, 1), new vec3(0, 0, 0.2), 6.0, 6.0)
    }

    const indBtn = this.indicatorRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
    indBtn.size = new vec3(10.0, 10.0, 10.0)
    indBtn.initialize()
    if (indBtn.visual) {
      const v = indBtn.visual as any
      if (typeof v.destroy === 'function') v.destroy()
      else if (v.getSceneObject) v.getSceneObject().destroy()
      else if (v.sceneObject) v.sceneObject.destroy()
    }
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
      // uiRoot world scale is ~1.0, so no invScale is needed; centerUIScale / leftUIScale /
      // rightUIScale directly control the layout dimensions.
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

    const script = this.panelRoot.createComponent("Component.ScriptComponent") as ScriptComponent
    const updateEvent = script.createEvent("UpdateEvent") as UpdateEvent
    updateEvent.bind(() => this.onUpdate())

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

    const BASE_c_w = 340;
    const BASE_c_h = 145;
    const BASE_c_d = 28;
    const BASE_s_w = 240;
    const BASE_s_h = 145;
    const BASE_s_d = 24;
    const BASE_screen_recess = 2.5;
    const side_angle = 35 * Math.PI / 180;
    const BASE_side_gap = 4;

    // Scales text rect width+height together (FitHeight renders at rect height).
    // Increase this constant to make all text larger; positions stay anchored to screen.
    const TS = 4.5;

    // ==========================================
    // --- CENTER MONITOR (Main & Packages) ---
    // ==========================================
    const SC_C = this.centerUIScale;
    const c_w = BASE_c_w * SC_C;
    const c_h = BASE_c_h * SC_C;
    const c_d = BASE_c_d * SC_C;
    
    const c_z_face = (c_d / 2) - (BASE_screen_recess * SC_C) + (2.0 * SC_C);
    const centerBasePos = new vec3(0, 0, c_z_face);
    const centerPos = new vec3(centerBasePos.x + this.centerUIOffset.x, centerBasePos.y + this.centerUIOffset.y, centerBasePos.z + this.centerUIOffset.z);
    const centerRoot = makeObject(scaledRoot, this.layer, "CenterMonitor", centerPos);
    centerRoot.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(this.centerUIRot.x * Math.PI/180, this.centerUIRot.y * Math.PI/180, this.centerUIRot.z * Math.PI/180)));
    
    this.centerRoot = centerRoot
    this.baseCenterUIPos = centerPos
    
    // Create 3 Data Tubes for the scanning animation
    this.dataTubes = []
    this.dataChunks = []
    for (let i = 0; i < 3; i++) {
       const tubeRoot = makeObject(centerRoot, this.layer, `DataTube_${i}`, vec3.zero())
       
       // Draw a 3D curved wire using 15 segments
       const segments = 15;
       let prevPos = this.getTubeCurve(i, 0, SC_C, c_h)
       for (let s = 1; s <= segments; s++) {
           const t = s / segments;
           const curPos = this.getTubeCurve(i, t, SC_C, c_h)
           // Make the wire thick and solid to look like a glowing 3D conduit (opacity lowered so chunks are visible)
           this.makeLine3D(tubeRoot, `WireSeg_${s}`, prevPos, curPos, 6.0 * SC_C, new vec4(0, 1, 1, 0.2))
           prevPos = curPos;
       }
       
       this.dataTubes.push(tubeRoot)
       
       // Create a chunk for each tube
       const chunkRoot = makeObject(tubeRoot, this.layer, `Chunk_${i}`, vec3.zero())
       chunkRoot.enabled = false
       const txt = makeText(chunkRoot, this.layer, `ChunkTxt_${i}`, "0101", FS_BODY * SC_C * TS, C_CYAN, vec3.zero(), 30 * SC_C * TS, 10 * SC_C * TS)
       this.dataChunks.push({ obj: chunkRoot, tubeIndex: i, progress: Math.random(), text: txt })
    }
    
    const displayName = this.device.bt_name || this.device.hostname || "UNKNOWN"
    makeText(centerRoot, this.layer, "Header", `> ${displayName}_`, (FS_TITLE * 1.75) * SC_C * TS, C_WHITE, new vec3(0, c_h/2 - (35 * SC_C), 0), (c_w - (20 * SC_C)) * TS, 60 * SC_C * TS)
    const cves = this.device.ar_summary?.cveCount || 0
    makeText(centerRoot, this.layer, "SubHeader", `TOTAL CVE: ${cves} | THREAT: ${tLevel.toUpperCase()}`, (FS_SMALL * 1.75) * SC_C * TS, tColor, new vec3(0, c_h/2 - (65 * SC_C), 0), (c_w - (20 * SC_C)) * TS, 40 * SC_C * TS)
    
    const counts = this.device.ar_summary?.sourceCounts || {}
    let totalVulns = 0
    for (const count of Object.values(counts)) {
      totalVulns += count
    }
    
    const ports = this.device.ar_summary?.openPorts || [];

    let yOffset = c_h/2 - (95 * SC_C);
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
        const labelW = 80 * SC_C * TS;
        const valW = 40 * SC_C * TS;
        // Shift anchors to the right by half the bounding box width to counteract center-anchored bounding boxes
        makeText(centerRoot, this.layer, `Txt_${src}`, `> ${src}:`, FS_SMALL * SC_C * TS, C_CYAN, new vec3(-c_w/2 + (50 * SC_C) + labelW/2, yOffset, 0), labelW, 20 * SC_C * TS, HorizontalAlignment.Left)
        makePlate(centerRoot, this.layer, `Bar_${src}`, new vec2(w, 6 * SC_C), new vec3(-c_w/2 + (100 * SC_C) + w/2, yOffset, 0), tColor, 2 * SC_C, undefined, 0, 0)
        makeText(centerRoot, this.layer, `Val_${src}`, `${count}`, FS_SMALL * SC_C * TS, C_WHITE, new vec3(-c_w/2 + (115 * SC_C) + w + valW/2, yOffset, 0), valW, 20 * SC_C * TS, HorizontalAlignment.Left)
        yOffset -= (5 * SC_C * TS)
      }
    }

    // ==========================================
    // --- RIGHT MONITOR (Radar Chart) ---
    // ==========================================
    const SC_R = this.rightUIScale;
    const r_s_w = BASE_s_w * SC_R;
    const r_s_h = BASE_s_h * SC_R;
    const r_s_d = BASE_s_d * SC_R;
    
    const r_s_z_face = (r_s_d / 2) - (BASE_screen_recess * SC_R) + (0.1 * SC_R);
    // Use SC_C for pivot calculation so the side panels physically attach to the center panel's edge 
    // even if the user applies different scales to each panel!
    const r_pivot_x = (BASE_c_w / 2 + BASE_side_gap) * SC_C;
    const rightPivot = makeObject(scaledRoot, this.layer, "RightPivot", new vec3(r_pivot_x, 0, 0));
    rightPivot.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(0, -side_angle, 0)));
    
    const rBasePos = new vec3(r_s_w / 2, 0, r_s_z_face);
    const rightPos = new vec3(rBasePos.x + this.rightUIOffset.x, rBasePos.y + this.rightUIOffset.y, rBasePos.z + this.rightUIOffset.z);
    const rightRoot = makeObject(rightPivot, this.layer, "RightMonitor", rightPos);
    rightRoot.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(this.rightUIRot.x * Math.PI/180, this.rightUIRot.y * Math.PI/180, this.rightUIRot.z * Math.PI/180)));
    
    this.rightRoot = rightRoot
    this.baseRightUIPos = rightPos
    
    const problems = this.device.ar_summary?.problems || []

    if (problems.length > 3) {
      makeText(rightRoot, this.layer, "R_Header", "ACTION ITEMS (CONT.)", FS_SMALL * SC_R * TS, C_CYAN, new vec3(0, r_s_h/2 - (15 * SC_R), 0), (r_s_w - (20 * SC_R)) * TS, 20 * SC_R * TS);
      
      let pY = r_s_h/2 - (40 * SC_R)
      for (let i = 3; i < Math.min(problems.length, 6); i++) {
        const prob = problems[i]
        const prio = prob.priority.toLowerCase()
        let pColor = new vec4(0.2, 1, 0.2, 1) // Green for low/other
        if (prio === "medium") pColor = new vec4(1, 0.7, 0, 1) // Yellow/orange for medium
        else if (prio === "high" || prio === "critical") pColor = new vec4(1, 0.2, 0.2, 1) // Red for high/critical

        // Problem text
        const textW = (r_s_w - (70 * SC_R)) * TS
        const startX = -r_s_w/2 + (15 * SC_R)
        const posX = startX + textW/2
        
        makeText(rightRoot, this.layer, `Prob_${i}`, `[${prob.priority}] ${prob.description}`, FS_SMALL * SC_R * TS, pColor, new vec3(posX, pY, 0), textW, 16 * SC_R * TS, HorizontalAlignment.Left)

        // FIX button
        const fixBtnRoot = makeObject(rightRoot, this.layer, `FixBtn_${i}`, new vec3((r_s_w/2) - (28 * SC_R), pY - (6 * SC_R), 0))
        makeText(fixBtnRoot, this.layer, "Txt", "FIX", FS_SMALL * SC_R * TS, C_WHITE, new vec3(0, 0, 0.2), 16 * SC_R * TS, 8 * SC_R * TS)
        const fixBtn = fixBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
        fixBtn.size = new vec3(20 * SC_R, 10 * SC_R, 2.0)
        fixBtn.initialize()
        // Color match the button to the severity level with some transparency
        this.configureBtn(fixBtn, new vec4(pColor.r * 0.5, pColor.g * 0.5, pColor.b * 0.5, 0.8), () => this.showFixPopup(prob))
        
        pY -= (35 * SC_R)
      }
    } else {
      makeText(rightRoot, this.layer, "R_Header", "THREAT ANALYSIS", FS_SMALL * SC_R * TS, C_CYAN, new vec3(0, r_s_h/2 - (10 * SC_R), 0), (r_s_w - (20 * SC_R)) * TS, 20 * SC_R * TS);
      
      const radarRoot = makeObject(rightRoot, this.layer, "Radar", new vec3(0, -10 * SC_R, 0));
      const numAxes = 5;
      const radius = 35 * SC_R;
      const labels = ["DENSITY", "NETWORK", "PRIVESC", "OS", "CONFIG"];
      const os = this.device.ar_summary?.os?.toLowerCase() || "unknown"
      const pScore = ports.length > 5 ? 1.0 : (ports.length / 5.0);
      const cScore = Math.min(1.0, cves / 50.0);
      const oScore = os.includes("windows") ? 0.8 : (os.includes("linux") ? 0.5 : 0.3);
      const scores = [cScore, pScore, this.isHighThreat ? 0.9 : 0.4, oScore, 0.6];
      
      const dataPts: vec3[] = [];
      for (let i = 0; i < numAxes; i++) {
        const a = Math.PI / 2 - (Math.PI * 2 * i) / numAxes;
        const pt = new vec3(Math.cos(a) * radius * scores[i], Math.sin(a) * radius * scores[i], 0);
        dataPts.push(pt);
        
        const labelOffset = 26 * SC_R;
        const lp = new vec3(Math.cos(a) * (radius + labelOffset), Math.sin(a) * (radius + labelOffset), 0);
        
        const labelRoot = makeObject(radarRoot, this.layer, `LblRoot_${i}`, lp);
        const labelVis = makeObject(labelRoot, this.layer, `LblVis_${i}`, vec3.zero());
        makeText(labelVis, this.layer, `Lbl_${i}`, labels[i], FS_BODY * SC_R * TS, tColor, vec3.zero(), 120 * SC_R * TS, 40 * SC_R * TS, HorizontalAlignment.Center);
        
        // Question mark hint (hidden by default)
        const qTxtR = makeText(labelVis, this.layer, `QTxt_${i}`, "?", FS_TITLE * SC_R * TS, C_CYAN, new vec3(25 * SC_R, 8 * SC_R, 0.5), 20 * SC_R * TS, 20 * SC_R * TS, HorizontalAlignment.Center, 35);
        qTxtR.enabled = false;
        
        const collider = labelRoot.createComponent("Physics.ColliderComponent") as ColliderComponent;
        collider.fitVisual = false;
        const boxShape = Shape.createBoxShape();
        boxShape.size = new vec3(35.0 * SC_R, 15.0 * SC_R, 2.0);
        collider.shape = boxShape;

        const interactable = labelRoot.createComponent(Interactable.getTypeName()) as Interactable;
        interactable.targetingMode = TargetingMode.All;

        interactable.onHoverEnter.add(() => {
            qTxtR.enabled = true;
            labelVis.getTransform().setLocalPosition(new vec3(0, 0, 10.0)); // Float only the visuals
        });
        
        interactable.onHoverExit.add(() => {
            qTxtR.enabled = false;
            labelVis.getTransform().setLocalPosition(vec3.zero()); // Reset
        });

        const ctxStr = `You are an AI embedded in an AR cybersecurity dashboard. Briefly explain what the threat analysis metric '${labels[i]}' means in the context of a cyber spider-web threat analysis diagram. The current target device is ${this.device.hostname} (OS: ${os}). Keep it concise and highly relevant to an active AR cyber operation.`;
        interactable.onTriggerEnd.add(() => {
          if (this.selectAudio) this.selectAudio.play(1)
          this.showNotebook(`METRIC: ${labels[i]}`, ctxStr)
        });

        this.makeLine(radarRoot, `Axis_${i}`, vec3.zero(), new vec3(Math.cos(a) * radius, Math.sin(a) * radius, 0), 0.5 * SC_R, new vec4(0, 1, 0.8, 0.4));
      }
      
      // Draw concentric grid layers (spiderweb)
      const numSteps = 5;
      for (let step = 1; step <= numSteps; step++) {
        const rStep = radius * (step / numSteps);
        for (let i = 0; i < numAxes; i++) {
          const a1 = Math.PI / 2 - (Math.PI * 2 * i) / numAxes;
          const a2 = Math.PI / 2 - (Math.PI * 2 * ((i + 1) % numAxes)) / numAxes;
          
          const pt1 = new vec3(Math.cos(a1) * rStep, Math.sin(a1) * rStep, 0);
          const pt2 = new vec3(Math.cos(a2) * rStep, Math.sin(a2) * rStep, 0);
          
          this.makeLine(radarRoot, `Grid_${step}_${i}`, pt1, pt2, 0.3 * SC_R, new vec4(0, 1, 0.8, 0.2));
        }
      }
      
      for (let i = 0; i < numAxes; i++) {
        this.makeLine(radarRoot, `Data_${i}`, dataPts[i], dataPts[(i + 1) % numAxes], 2.0 * SC_R, tColor);
      }
    }

    // ==========================================
    // --- LEFT MONITOR (Network Nodes & Ports) ---
    // ==========================================
    const SC_L = this.leftUIScale;
    const l_s_w = BASE_s_w * SC_L;
    const l_s_h = BASE_s_h * SC_L;
    const l_s_d = BASE_s_d * SC_L;
    
    const l_s_z_face = (l_s_d / 2) - (BASE_screen_recess * SC_L) + (0.1 * SC_L);
    // Use SC_C for pivot calculation so the side panels physically attach to the center panel's edge
    const l_pivot_x = (BASE_c_w / 2 + BASE_side_gap) * SC_C;
    const leftPivot = makeObject(scaledRoot, this.layer, "LeftPivot", new vec3(-l_pivot_x, 0, 0));
    leftPivot.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(0, side_angle, 0)));
    
    const lBasePos = new vec3(-l_s_w / 2, 0, l_s_z_face);
    const leftPos = new vec3(lBasePos.x + this.leftUIOffset.x, lBasePos.y + this.leftUIOffset.y, lBasePos.z + this.leftUIOffset.z);
    const leftRoot = makeObject(leftPivot, this.layer, "LeftMonitor", leftPos);
    leftRoot.getTransform().setLocalRotation(quat.fromEulerVec(new vec3(this.leftUIRot.x * Math.PI/180, this.leftUIRot.y * Math.PI/180, this.leftUIRot.z * Math.PI/180)));
    
    this.leftRoot = leftRoot
    this.baseLeftUIPos = leftPos
    
    // Problems variable was moved up.

    if (problems.length > 0) {
      // AI Rendered Action Items
      makeText(leftRoot, this.layer, "L_Header", "ACTION ITEMS", FS_SMALL * SC_L * TS, C_CYAN, new vec3(0, l_s_h/2 - (15 * SC_L), 0), (l_s_w - (20 * SC_L)) * TS, 20 * SC_L * TS);
      
      let pY = l_s_h/2 - (40 * SC_L)
      for (let i = 0; i < Math.min(problems.length, 3); i++) {
        const prob = problems[i]
        const prio = prob.priority.toLowerCase()
        let pColor = new vec4(0.2, 1, 0.2, 1) // Green for low/other
        if (prio === "medium") pColor = new vec4(1, 0.7, 0, 1) // Yellow/orange for medium
        else if (prio === "high" || prio === "critical") pColor = new vec4(1, 0.2, 0.2, 1) // Red for high/critical

        // Problem text
        const textW = (l_s_w - (70 * SC_L)) * TS
        const startX = -l_s_w/2 + (15 * SC_L)
        const posX = startX + textW/2
        
        makeText(leftRoot, this.layer, `Prob_${i}`, `[${prob.priority}] ${prob.description}`, FS_SMALL * SC_L * TS, pColor, new vec3(posX, pY, 0), textW, 16 * SC_L * TS, HorizontalAlignment.Left)

        // FIX button
        const fixBtnRoot = makeObject(leftRoot, this.layer, `FixBtn_${i}`, new vec3((l_s_w/2) - (28 * SC_L), pY - (6 * SC_L), 0))
        makeText(fixBtnRoot, this.layer, "Txt", "FIX", FS_SMALL * SC_L * TS, C_WHITE, new vec3(0, 0, 0.2), 16 * SC_L * TS, 8 * SC_L * TS)
        const fixBtn = fixBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
        fixBtn.size = new vec3(20 * SC_L, 10 * SC_L, 2.0)
        fixBtn.initialize()
        // Color match the button to the severity level with some transparency
        this.configureBtn(fixBtn, new vec4(pColor.r * 0.5, pColor.g * 0.5, pColor.b * 0.5, 0.8), () => this.showFixPopup(prob))
        
        pY -= (35 * SC_L)
      }
    } else {
      // Default Network Rendering
      makeText(leftRoot, this.layer, "L_Header", "NETWORK DIAGNOSTICS", FS_SMALL * SC_L * TS, C_CYAN, new vec3(0, l_s_h/2 - (25 * SC_L), 0), (l_s_w - (20 * SC_L)) * TS, 20 * SC_L * TS);
      
      const C_GREEN = new vec4(0.2, 1.0, 0.2, 1.0);
      const C_ORANGE = new vec4(1.0, 0.5, 0.0, 1.0);
      const C_RED = new vec4(1.0, 0.2, 0.2, 1.0);
      
      const netCenter = makeObject(leftRoot, this.layer, "NetCenter", new vec3(0, -10 * SC_L, 0));
      
      // OPEN PORTS Centered above the network icon
      makeText(netCenter, this.layer, "L_PortsLabel", "OPEN PORTS", FS_SMALL * SC_L * TS, C_RED, new vec3(0, 12 * SC_L, 0), 100 * SC_L * TS, 20 * SC_L * TS, HorizontalAlignment.Center);
      
      makeText(netCenter, this.layer, "NetIcon", "[ NETWORK ]", FS_SMALL * SC_L * TS, C_WHITE, vec3.zero(), 100 * SC_L * TS, 20 * SC_L * TS);
      const numPorts = Math.min(ports.length, 6);
      if (numPorts === 0) {
        makeText(leftRoot, this.layer, "L_Ports", `PORTS: NONE`, FS_TINY * SC_L * TS, C_ORANGE, new vec3(0, l_s_h/2 - (75 * SC_L), 0), (l_s_w - (20 * SC_L)) * TS, 15 * SC_L * TS);
      } else {
        const r = 45.0 * SC_L;
        for (let i = 0; i < numPorts; i++) {
          const a = (Math.PI * 2 * i) / numPorts;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          
          const p = ports[i];
          const pVal = p.port || p;
          const commonPorts: Record<string, string> = {
            "22": "ssh", "80": "http", "443": "https", "3000": "node", "5000": "flask", "8080": "http-alt", "3306": "mysql", "5432": "postgres", "21": "ftp", "23": "telnet", "25": "smtp", "3389": "rdp", "5900": "vnc"
          };
          const pStr = pVal.toString();
          const portStr = commonPorts[pStr] ? `${pStr}\n(${commonPorts[pStr]})` : pStr;
          
          const portRoot = makeObject(netCenter, this.layer, `PortRoot_${i}`, new vec3(px, py, 0));
          const portVis = makeObject(portRoot, this.layer, `PortVis_${i}`, vec3.zero());
          makeText(portVis, this.layer, `PortTxt_${i}`, portStr, FS_SMALL * SC_L * TS, C_GREEN, vec3.zero(), 80 * SC_L * TS, 40 * SC_L * TS, HorizontalAlignment.Center);
          
          // Question mark for info hint (hidden by default)
          const qTxt = makeText(portVis, this.layer, `QTxt_${i}`, "?", FS_TITLE * SC_L * TS, C_CYAN, new vec3(12 * SC_L, 8 * SC_L, 0.5), 20 * SC_L * TS, 20 * SC_L * TS, HorizontalAlignment.Center, 35);
          qTxt.enabled = false;
          
          const collider = portRoot.createComponent("Physics.ColliderComponent") as ColliderComponent;
          collider.fitVisual = false;
          const boxShape = Shape.createBoxShape();
          boxShape.size = new vec3(15.0, 15.0, 2.0); // Slightly larger hitbox
          collider.shape = boxShape;

          const interactable = portRoot.createComponent(Interactable.getTypeName()) as Interactable;
          interactable.targetingMode = TargetingMode.All;

          interactable.onHoverEnter.add(() => {
            qTxt.enabled = true;
            portVis.getTransform().setLocalPosition(new vec3(0, 0, 10.0)); // Float only the visuals
          });
          
          interactable.onHoverExit.add(() => {
            qTxt.enabled = false;
            portVis.getTransform().setLocalPosition(vec3.zero()); // Reset
          });

          interactable.onTriggerEnd.add(() => {
            if (this.selectAudio) this.selectAudio.play(1)
            this.showNotebook(`Port ${pStr}`, `Open port ${pStr} on ${this.device.hostname}`)
          });

          this.makeLine(netCenter, `PLine_${i}`, vec3.zero(), new vec3(px, py, 0), 0.5 * SC_L, new vec4(1, 0.2, 0.2, 0.3));
        }
      }

      for (let i = 0; i < 6; i++) {
        const node = makeObject(netCenter, this.layer, `Node_${i}`, vec3.zero());
        makePlate(node, this.layer, `NodePlt_${i}`, new vec2(6 * SC_L, 6 * SC_L), vec3.zero(), new vec4(1.0, 0.2, 0.2, 1.0), 1.0 * SC_L, undefined, 0, 0);
        this.orbitingNodes.push(node);
      }
    }
  }

  private triggerAnalysis(btn: RectangleButton, root: SceneObject): void {
    if (!this.apiUrlBase && !DemoState.isDemoMode) return
    btn.enabled = false
    const txt = root.getChild(0).getComponent("Component.Text") as Text
    if (txt) txt.text = "ANALYZING..."
    
    this.isAnalyzing = true
    this.analysisStartTime = getTime()
    this.analysisCompleted = false

    if (this.analyzeAudio) {
      this.analyzeAudio.play(1)
    }

    if (DemoState.isDemoMode) {
      const delay = root.createComponent("Component.ScriptComponent") as ScriptComponent
      const ev = delay.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
      ev.bind(() => {
        if (this.analyzeAudio) this.analyzeAudio.stop(false)
        this.analysisCompleted = true
        if (txt) txt.text = "ANALYSIS COMPLETE"
        btn.enabled = true
        
        // Dynamically inject the mock problems to simulate a completed analysis finding new issues!
        const MOCK_PROBLEMS = require("./Data/MockDevices").MOCK_PROBLEMS
        if (MOCK_PROBLEMS && MOCK_PROBLEMS[this.device.hostname]) {
            if (!this.device.ar_summary) this.device.ar_summary = {} as any
            this.device.ar_summary.problems = MOCK_PROBLEMS[this.device.hostname]
            
            // Force the UI to rebuild and render the newly discovered Action Items
            this.updateDeviceData(this.device)
        }
      })
      ev.reset(5.0)
      return
    }

    try {
      const request = RemoteServiceHttpRequest.create()
      request.url = `${this.apiUrlBase}/api/analyze/${this.device.hostname}`
      request.method = RemoteServiceHttpRequest.HttpRequestMethod.Post
      
      this.internetModule.performHttpRequest(request, (response: RemoteServiceHttpResponse) => {
        if (this.analyzeAudio) this.analyzeAudio.stop(false)
        this.analysisCompleted = true
        if (response.statusCode === 200) {
          if (txt) txt.text = "ANALYSIS COMPLETE"
          try {
            const data = JSON.parse(response.body)
            if (data.arSummary) {
              this.updateDeviceData(normalizeDevice(data.arSummary))
            }
          } catch(e) {
            print(`Failed to parse updated device: ${e}`)
          }
        } else {
          if (txt) txt.text = "ANALYSIS FAILED"
        }
        btn.enabled = true
      })
    } catch (e) {
      if (this.analyzeAudio) this.analyzeAudio.stop(false)
      if (txt) txt.text = "ERROR"
      btn.enabled = true
      this.analysisCompleted = true
    }
  }

  private showFixPopup(problem: any): void {
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
      terminalInstance.getTransform().setLocalPosition(this.shellTerminalOffset)
      terminalInstance.getTransform().setLocalScale(new vec3(this.shellTerminalScale, this.shellTerminalScale, this.shellTerminalScale)) 
      
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
      
      if (DemoState.isDemoMode) {
        const delay = popupRoot.createComponent("Component.ScriptComponent") as ScriptComponent
        const ev = delay.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
        ev.bind(() => {
          if (txt) txt.text = "SUCCESS"
          const delay2 = popupRoot.createComponent("Component.ScriptComponent") as ScriptComponent
          const closeEv = delay2.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
          closeEv.bind(closePopup)
          closeEv.reset(1.0)
        })
        ev.reset(2.0)
        return
      }

      try {
        const request = RemoteServiceHttpRequest.create()
        request.url = `${this.apiUrlBase}/api/approve-action`
        request.method = RemoteServiceHttpRequest.HttpRequestMethod.Post
        request.setHeader("Content-Type", "application/json")
        request.body = JSON.stringify({
          hostname: this.device.hostname,
          actionLabel: problem.fixLabel || "FIX",
          command: problem.fixCommand,
          approved: true
        })
        
        this.internetModule.performHttpRequest(request, (response: RemoteServiceHttpResponse) => {
          if (response.statusCode === 200) {
            if (txt) txt.text = "SUCCESS"
            const delayed = popupRoot.createComponent("Component.ScriptComponent") as ScriptComponent
            const evt = delayed.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
            evt.bind(() => {
              // Delete the problem locally
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
            evt.reset(2.0)
          } else {
            if (txt) txt.text = "FAILED"
            approveBtn.enabled = true
          }
        })
      } catch (e) {
        if (txt) txt.text = "ERROR"
        approveBtn.enabled = true
      }
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
      nbInstance.getTransform().setLocalPosition(this.notebookOffset);
      nbInstance.getTransform().setLocalScale(new vec3(this.notebookScale, this.notebookScale, this.notebookScale));
      uiNode = makeObject(this.notebookRoot, this.layer, "NotebookUINode", vec3.zero());
    } else {
      makePlate(this.notebookRoot, this.layer, "Bg", new vec2(50.0, 40.0), vec3.zero(), new vec4(0, 0, 0, 0.95), 5.0, C_CYAN, 0.5, 0);
      uiNode = makeObject(this.notebookRoot, this.layer, "NotebookUINode", vec3.zero());
    }

    const C_GLOW_GREEN = new vec4(0.0, 1.0, 0.25, 1.0);
    
    // Position text in the exact same screen region as the Shell Terminal
    const titleTxt = makeText(uiNode, this.layer, "NTitle", `[ INFO: ${topic.toUpperCase()} ]`, FS_SMALL, C_GLOW_GREEN, this.notebookTitlePos, 22.0, 10.0, HorizontalAlignment.Center);
    
    // Height is 80.0. With VerticalAlignment.Top, text starts at y + (height/2).
    const bodyTxt = makeText(uiNode, this.layer, "NBody", "LOADING...", FS_SMALL, C_WHITE, this.notebookTextPos, 16.0, 80.0, HorizontalAlignment.Left, 30, true, VerticalAlignment.Top);

    // Minimalist, sophisticated close button at top-left
    const closeBtnRoot = makeObject(uiNode, this.layer, "NCloseBtn", this.notebookCloseBtnPos);
    
    // Explicit red circular background plate
    const bgPlate = makePlate(closeBtnRoot, this.layer, "CBg", new vec2(1.5, 1.5), new vec3(0, 0, 0.0), new vec4(0.8, 0.1, 0.1, 1.0), 30, undefined, 0, 0.75);
    
    // The "X" text (shifted slightly forward in Z to avoid clipping with the red plate)
    makeText(closeBtnRoot, this.layer, "CTxt", "X", FS_TINY, C_WHITE, new vec3(0, 0, 0.5), 10.0, 10.0);
    
    const closeBtn = closeBtnRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton;
    closeBtn.size = new vec3(5.0, 5.0, 4.0);
    closeBtn.initialize();
    if (closeBtn.visual) {
      const v = closeBtn.visual as any;
      if (typeof v.destroy === 'function') v.destroy();
      else if (v.getSceneObject) v.getSceneObject().destroy();
      else if (v.sceneObject) v.sceneObject.destroy();
    }

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

    if (!this.apiUrlBase && !DemoState.isDemoMode) {
      bodyTxt.text = "OFFLINE MODE";
      return;
    }

    if (DemoState.isDemoMode) {
      const delay = uiNode.createComponent("Component.ScriptComponent") as ScriptComponent
      const ev = delay.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
      ev.bind(() => {
        bodyTxt.text = "This is a simulated AI explanation for demo mode.\n\n" +
                       `You requested info about: ${topic}\n` +
                       "In a real environment, this data is fetched from the Underlayer backend using an LLM to explain the vulnerability or open port in context.\n\n" +
                       "Risk has been flagged as moderate. Proceed with caution."
      })
      ev.reset(2.0)
      return
    }

    try {
      const request = RemoteServiceHttpRequest.create();
      request.url = `${this.apiUrlBase}/api/learn`;
      request.method = RemoteServiceHttpRequest.HttpRequestMethod.Post;
      request.setHeader("Content-Type", "application/json");
      request.body = JSON.stringify({
        topic: topic,
        context: contextStr || ""
      });

      this.internetModule.performHttpRequest(request, (response: RemoteServiceHttpResponse) => {
        if (response.statusCode === 200) {
          try {
            const data = JSON.parse(response.body);
            bodyTxt.text = data.info || "No explanation returned.";
          } catch (e) {
            bodyTxt.text = `PARSE ERROR: ${response.body}`;
          }
        } else {
          bodyTxt.text = `API ERROR: ${response.statusCode}\n${response.body}`;
        }
      });
    } catch (e) {
      bodyTxt.text = "NETWORK EXCEPTION";
    }
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

  private configureBtn(btn: RectangleButton, defaultColor: vec4, tapCallback: () => void): void {
    btn.onTriggerUp.add(() => {
      if (this.selectAudio) this.selectAudio.play(1)
      tapCallback()
    })
    const visual = btn.visual as RoundedRectangleVisual
    if (visual) {
      visual.shouldColorChange = true
      visual.baseDefaultColor = defaultColor
      visual.baseHoveredColor = new vec4(defaultColor.r + 0.1, defaultColor.g + 0.1, defaultColor.b + 0.1, defaultColor.a + 0.2)
      visual.baseTriggeredColor = new vec4(defaultColor.r + 0.2, defaultColor.g + 0.2, defaultColor.b + 0.2, defaultColor.a + 0.4)
      visual.defaultHasBorder = false
    }
  }

  public setExpanded(expanded: boolean): void {
    if (this.indicatorRoot) this.indicatorRoot.enabled = !expanded
    if (this.uiRoot) this.uiRoot.enabled = expanded

    // If closing monitors in Demo Mode, wipe the mock problems and rebuild the UI
    if (!expanded && DemoState.isDemoMode && this.device?.ar_summary?.problems) {
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
          const SC_C = this.centerUIScale
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
        const r = 40.0 * this.leftUIScale;
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
    // Hide problems again when the monitor is closed in Demo Mode
    if (DemoState.isDemoMode && this.device?.ar_summary?.problems) {
      this.device.ar_summary.problems = []
    }

    if (this.panelRoot) {
      this.panelRoot.destroy()
    }
  }
}
