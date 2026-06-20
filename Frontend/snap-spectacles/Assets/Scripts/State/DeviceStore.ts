/**
 * DeviceStore.ts
 * Single source of truth for the device list. Owns normalization (via DeviceParser) and the
 * merge logic that used to live inline in DeviceListPanel.handleWebSocketMessage, and emits
 * typed signals so the UI can re-render without the data layer knowing about it.
 *
 * Note: active detail-panel tracking and the hot-swap that rebuilds a DeviceDetailPanel stay in
 * DeviceListPanel, because constructing a panel depends on ~30 of that component's @inputs.
 * onDeviceUpdated is the seam the panel listens to in order to perform that hot-swap.
 */

import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {Device} from "../Data/DeviceTypes"
import {normalizeDevice} from "../Data/DeviceParser"

export class DeviceStore {
  private static instance: DeviceStore | undefined

  private devices: Device[] = []

  /** Fired whenever the full device list changes (initial load or a single update). */
  readonly onDevicesChanged = new Event<Device[]>()
  /** Fired with the normalized device when a single device is updated/added. */
  readonly onDeviceUpdated = new Event<Device>()

  static getInstance(): DeviceStore {
    if (!DeviceStore.instance) {
      DeviceStore.instance = new DeviceStore()
    }
    return DeviceStore.instance
  }

  getDevices(): Device[] {
    return this.devices
  }

  /** Replace the entire list (normalizing each entry) and notify subscribers. */
  setDevices(rawDevices: Device[]): void {
    this.devices = (rawDevices || []).map((device) => normalizeDevice(device))
    this.onDevicesChanged.invoke(this.devices)
  }

  /** Merge a single device update into the list and notify subscribers. */
  applyDeviceUpdate(rawDevice: Device): Device {
    const updatedDevice = normalizeDevice(rawDevice)
    const updatedDevices = this.devices.slice()
    const existingIndex = updatedDevices.findIndex((d) => d.deviceId === updatedDevice.deviceId)
    if (existingIndex >= 0) updatedDevices[existingIndex] = updatedDevice
    else updatedDevices.push(updatedDevice)
    this.devices = updatedDevices
    this.onDevicesChanged.invoke(this.devices)
    this.onDeviceUpdated.invoke(updatedDevice)
    return updatedDevice
  }
}
