/**
 * DeviceDataSourceProvider.ts
 * Singleton facade the panels consume as an IDeviceDataSource. Holds one live and one mock
 * source and routes most calls to whichever matches the current DemoState.
 *
 * IMPORTANT: This is the ONLY file in the app that reads DemoState. UI/state code asks the
 * provider for `isLive` instead of touching the global flag, which keeps the runtime DEMO
 * toggle working while the rest of the codebase stays demo-agnostic.
 */

import {DemoState} from "../Data/DeviceTypes"
import {HttpClient} from "../Net/HttpClient"
import {Device} from "../Data/DeviceTypes"
import {IDeviceDataSource, ApproveActionRequest, AnalyzeResult, ActionResult} from "./IDeviceDataSource"
import {LiveDeviceDataSource} from "./LiveDeviceDataSource"
import {MockDeviceDataSource} from "./MockDeviceDataSource"

export class DeviceDataSourceProvider implements IDeviceDataSource {
  private static instance: DeviceDataSourceProvider | undefined

  private live: LiveDeviceDataSource | undefined
  private mock: MockDeviceDataSource | undefined

  static getInstance(): DeviceDataSourceProvider {
    if (!DeviceDataSourceProvider.instance) {
      DeviceDataSourceProvider.instance = new DeviceDataSourceProvider()
    }
    return DeviceDataSourceProvider.instance
  }

  /**
   * Wire up the concrete sources. Called once from DeviceListPanel.init() using the existing
   * websocketUrl @input for the base URL and the panel itself as the delay host.
   */
  configure(http: HttpClient, host: ScriptComponent): void {
    this.live = new LiveDeviceDataSource(http, host)
    this.mock = new MockDeviceDataSource(host)
  }

  /** The single point that consults DemoState. */
  private get active(): IDeviceDataSource {
    return DemoState.isDemoMode ? this.mock! : this.live!
  }

  get isLive(): boolean {
    return this.active.isLive
  }

  getDevices(): Promise<Device[]> {
    return this.active.getDevices()
  }

  triggerScan(): Promise<boolean> {
    return this.active.triggerScan()
  }

  analyze(device: Device): Promise<AnalyzeResult> {
    return this.active.analyze(device)
  }

  approveAction(req: ApproveActionRequest): Promise<ActionResult> {
    return this.active.approveAction(req)
  }

  learn(topic: string, context: string): Promise<string> {
    // Demo Mode should still feel intelligent: keep mocked devices/actions, but ask the
    // backend for notebook explanations so Gemini/offline knowledge behave like Live Mode.
    return this.live ? this.live.learn(topic, context) : this.active.learn(topic, context)
  }
}
