/**
 * UiBuilders.ts
 * Procedural scene-graph builders (makeObject / makeText / makePlate), moved verbatim from
 * DeviceListPanel.ts. Behavior and output are intentionally identical to preserve the exact
 * holographic visuals — only the file location changed.
 */

import {RoundedRectangle} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {RoundedRectangleVisual} from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual"
import {getActiveHudFont} from "./Theme"

export function makeObject(
  parent: SceneObject,
  layer: LayerSet,
  name: string,
  localPosition: vec3 = vec3.zero()
): SceneObject {
  const object = global.scene.createSceneObject(name)
  object.layer = layer
  object.setParent(parent)
  object.getTransform().setLocalPosition(localPosition)
  return object
}

export function makeText(
  parent: SceneObject,
  layer: LayerSet,
  name: string,
  content: string,
  size: number,
  color: vec4,
  localPosition: vec3,
  width: number,
  height: number,
  horizontalAlignment: HorizontalAlignment = HorizontalAlignment.Center,
  renderOrder: number = 30,
  wrap: boolean = false,
  verticalAlignment: VerticalAlignment = VerticalAlignment.Center
): Text {
  const object = makeObject(parent, layer, name, localPosition)
  const text = object.createComponent("Component.Text") as Text
  text.text = content
  text.size = size
  text.sizeToFit = false
  text.twoSided = true
  text.depthTest = false
  text.renderOrder = renderOrder
  text.worldSpaceRect = Rect.create(-width / 2, width / 2, -height / 2, height / 2)
  text.textFill.mode = TextFillMode.Solid
  text.textFill.color = color
  text.horizontalAlignment = horizontalAlignment
  text.verticalAlignment = verticalAlignment
  text.horizontalOverflow = wrap ? HorizontalOverflow.Wrap : HorizontalOverflow.Truncate
  text.verticalOverflow = VerticalOverflow.Truncate
  text.stretchMode = StretchMode.FitHeight
  const activeHudFont = getActiveHudFont()
  if (activeHudFont) text.font = activeHudFont
  return text
}

export function makePlate(
  parent: SceneObject,
  layer: LayerSet,
  name: string,
  size: vec2,
  localPosition: vec3,
  color: vec4,
  renderOrder: number,
  borderColor?: vec4,
  borderSize: number = 0,
  cornerRadius: number = 0.02
): RoundedRectangle {
  const object = makeObject(parent, layer, name, localPosition)
  const plate = object.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
  plate.size = size
  plate.cornerRadius = cornerRadius
  plate.gradient = false
  plate.useTexture = false
  plate.backgroundColor = color
  plate.border = borderColor !== undefined
  if (borderColor) {
    plate.borderType = "Color"
    plate.borderColor = borderColor
    plate.borderSize = borderSize
  }
  plate.renderOrder = renderOrder
  plate.initialize()

  plate.gradient = false
  plate.useTexture = false
  plate.backgroundColor = color
  plate.border = borderColor !== undefined
  if (borderColor) {
    plate.borderType = "Color"
    plate.borderColor = borderColor
    plate.borderSize = borderSize
  }
  return plate
}

export function configureButton(btn: RectangleButton, defaultColor: vec4, onTap: () => void): void {
  btn.onTriggerUp.add(onTap)
  const visual = btn.visual as RoundedRectangleVisual
  if (visual) {
    visual.shouldColorChange = true
    visual.baseDefaultColor = defaultColor
    visual.baseHoveredColor = new vec4(
      defaultColor.r + 0.1,
      defaultColor.g + 0.1,
      defaultColor.b + 0.1,
      defaultColor.a + 0.2
    )
    visual.baseTriggeredColor = new vec4(
      defaultColor.r + 0.2,
      defaultColor.g + 0.2,
      defaultColor.b + 0.2,
      defaultColor.a + 0.4
    )
    visual.defaultHasBorder = false
  }
}
