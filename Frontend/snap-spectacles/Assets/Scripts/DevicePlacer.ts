import {Device} from "./Data/DeviceTypes"
import {makeText} from "./UI/UiBuilders"
import {C_CYAN, C_WHITE, FS_SMALL} from "./UI/Theme"
import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {RoundedRectangleVisual} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual"

export class DevicePlacer {
  private script: ScriptComponent
  private modelRoot: SceneObject
  private modelInstance: SceneObject | null = null
  private updateEvent: UpdateEvent
  private tapEvent?: TapEvent
  private gestureModule?: any
  private pinchRightCb?: any
  private pinchLeftCb?: any
  
  private isPlaced = false

  constructor(
    private parentRoot: SceneObject,
    private layer: LayerSet,
    private cameraRoot: SceneObject,
    public device: Device,
    private prefab: ObjectPrefab | undefined,
    private modelScale: number,
    private onPlaced: (placer: DevicePlacer, worldPos: vec3) => void
  ) {
    // Create a dummy script component to attach events
    this.script = parentRoot.createComponent("Component.ScriptComponent") as ScriptComponent

    this.modelRoot = global.scene.createSceneObject(`UL_Placer_${device.hostname}`)
    this.modelRoot.layer = layer

    if (this.prefab) {
      this.modelInstance = this.prefab.instantiate(this.modelRoot)
      this.modelInstance.getTransform().setLocalPosition(vec3.zero())
      this.modelInstance.getTransform().setLocalScale(new vec3(this.modelScale, this.modelScale, this.modelScale)) 
    }

    // Add instructions
    makeText(
      this.modelRoot,
      this.layer,
      "UL_PlaceInst",
      "PINCH TO PLACE\n" + device.hostname,
      FS_SMALL,
      C_CYAN,
      new vec3(0, 20.0, 0), // 20 units above the model
      60.0,
      16.0
    )

    this.updateEvent = this.script.createEvent("UpdateEvent") as UpdateEvent
    this.updateEvent.bind(() => this.onUpdate())

    // Always bind TapEvent so mouse clicks work in the Lens Studio preview window
    this.tapEvent = this.script.createEvent("TapEvent") as TapEvent
    this.tapEvent.bind(() => this.onTap())

    // Add an invisible UI button to catch the pinch using the native interaction system
    // Offset it slightly towards the camera (Z=15) and make it thin to avoid cutting the 3D model
    const hitboxObj = global.scene.createSceneObject("Hitbox")
    hitboxObj.setParent(this.modelRoot)
    hitboxObj.layer = this.layer
    hitboxObj.getTransform().setLocalPosition(new vec3(0, 0, 15.0))
    
    const btn = hitboxObj.createComponent(RectangleButton.getTypeName()) as RectangleButton
    btn.size = new vec3(80.0, 80.0, 0.1)
    btn.initialize()
    
    // Temporarily scale down to hide the semi-transparent UI generation glitch
    hitboxObj.getTransform().setLocalScale(new vec3(0.001, 0.001, 0.001))
    
    // Hide the visual completely to prevent ANY rendering glitches
    // RectangleButton creates internal states that animate colors. Destroying the RenderMeshVisuals prevents it from ever being seen.
    const hideMeshes = (obj: SceneObject) => {
      const rmvs = obj.getComponents("Component.RenderMeshVisual")
      for (let i = 0; i < rmvs.length; i++) {
        rmvs[i].enabled = false
      }
      for (let i = 0; i < obj.getChildrenCount(); i++) {
        hideMeshes(obj.getChild(i))
      }
    }
    // Defer the hiding slightly to ensure the UI Kit has finished generating its meshes
    const delayEvent = this.script.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    delayEvent.bind(() => {
      hideMeshes(hitboxObj)
      // Restore scale so the hitbox works
      hitboxObj.getTransform().setLocalScale(new vec3(1, 1, 1))
    })
    delayEvent.reset(0.1)
    
    btn.onTriggerUp.add(() => this.onTap())
  }

  private onUpdate(): void {
    if (this.isPlaced) return

    // Position the model 88 units in front of the camera safely using quaternion rotation
    const camTransform = this.cameraRoot.getTransform()
    const camPos = camTransform.getWorldPosition()
    const camRot = camTransform.getWorldRotation()
    
    // -88 on Z is forward in camera local space
    const localOffset = new vec3(0, 0, -88.0)
    const worldOffset = camRot.multiplyVec3(localOffset)
    const targetPos = camPos.add(worldOffset)
    
    this.modelRoot.getTransform().setWorldPosition(targetPos)
    
    // Make it face the user (billboard Y axis)
    const lookDir = camPos.sub(targetPos)
    lookDir.y = 0 // Keep it upright
    if (lookDir.lengthSquared > 0.001) {
      const rot = quat.lookAt(lookDir.normalize(), vec3.up())
      this.modelRoot.getTransform().setWorldRotation(rot)
    }
  }

  private onTap(): void {
    if (this.isPlaced) return
    this.isPlaced = true
    
    // Stop updating position
    this.script.removeEvent(this.updateEvent)
    
    if (this.tapEvent) {
      this.script.removeEvent(this.tapEvent)
    }
    
    if (this.gestureModule) {
      try {
        const handTypeRight = this.gestureModule.HandType ? this.gestureModule.HandType.Right : 0;
        const handTypeLeft = this.gestureModule.HandType ? this.gestureModule.HandType.Left : 1;
        this.gestureModule.getPinchDownEvent(handTypeRight).remove(this.pinchRightCb);
        this.gestureModule.getPinchDownEvent(handTypeLeft).remove(this.pinchLeftCb);
      } catch (e) {
        // ignore removal errors
      }
    }

    const finalPos = this.modelRoot.getTransform().getWorldPosition()
    this.onPlaced(this, finalPos)
  }

  public getModelRoot(): SceneObject {
    return this.modelRoot
  }

  public destroy(): void {
    if (this.modelRoot) {
      this.modelRoot.destroy()
    }
    if (this.script) {
      this.script.destroy()
    }
  }
}
