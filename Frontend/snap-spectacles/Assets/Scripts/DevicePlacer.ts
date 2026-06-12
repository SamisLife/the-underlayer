import {Device} from "./Data/DeviceTypes"
import {makeText, C_CYAN, C_WHITE, FS_SMALL} from "./DeviceListPanel"

export class DevicePlacer {
  private script: ScriptComponent
  private modelRoot: SceneObject
  private modelInstance: SceneObject | null = null
  private updateEvent: UpdateEvent
  private tapEvent: TapEvent
  
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

    this.tapEvent = this.script.createEvent("TapEvent") as TapEvent
    this.tapEvent.bind(() => this.onTap())
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
    this.script.removeEvent(this.tapEvent)

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
