@component
export class WorldScannerEffect extends BaseScriptComponent {
  @input
  @hint("The RenderMeshVisual containing the World Mesh")
  meshVisual: RenderMeshVisual

  @input
  @hint("Duration of the scan in seconds")
  scanDuration: number = 5.0

  private material: Material

  onAwake(): void {
    if (this.meshVisual && this.meshVisual.mainMaterial) {
      // Clone the material so we don't permanently modify the asset
      this.material = this.meshVisual.mainMaterial.clone()
      this.meshVisual.mainMaterial = this.material
      this.setAlpha(0)
    }
  }

  public triggerScan(): void {
    if (!this.meshVisual || !this.material) {
      print("WorldScannerEffect: Missing meshVisual or material!")
      return
    }

    let t = 0
    const updateEvent = this.createEvent("UpdateEvent") as UpdateEvent
    updateEvent.bind(() => {
      t += getDeltaTime()
      
      let alpha = 0
      // 1-second fade in
      if (t < 1.0) {
        alpha = t 
      } 
      // Hold max alpha during scan
      else if (t < this.scanDuration - 1.0) {
        alpha = 1.0 
      } 
      // 1-second fade out
      else if (t < this.scanDuration) {
        alpha = this.scanDuration - t 
      } 
      // Done scanning
      else {
        alpha = 0
        this.removeEvent(updateEvent)
      }
      
      this.setAlpha(alpha)
    })
  }

  private setAlpha(alpha: number): void {
    // If using a standard PBR/Unlit material, opacity is usually in baseColor.a
    const pass = this.material.mainPass
    if (pass.baseColor) {
      pass.baseColor = new vec4(pass.baseColor.x, pass.baseColor.y, pass.baseColor.z, alpha)
    }
  }
}
