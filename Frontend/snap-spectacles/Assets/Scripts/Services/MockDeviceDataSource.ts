/**
 * MockDeviceDataSource.ts
 * Offline data source used in Demo Mode. Returns the canned MOCK_DEVICES / MOCK_PROBLEMS and
 * reproduces the original simulated latencies (scan 3s, analyze 5s, approve 2s, learn 2s) so
 * the demo experience is timing-identical. Delays run on an injected host ScriptComponent.
 */

import {Device} from "../Data/DeviceTypes"
import {MOCK_DEVICES, MOCK_PROBLEMS} from "../Data/MockDevices"
import {delaySeconds} from "../Util/Async"
import {IDeviceDataSource, ApproveActionRequest, AnalyzeResult, ActionResult} from "./IDeviceDataSource"

export class MockDeviceDataSource implements IDeviceDataSource {
  readonly isLive = false

  constructor(private readonly host: ScriptComponent) {}

  getDevices(): Promise<Device[]> {
    return Promise.resolve(MOCK_DEVICES)
  }

  triggerScan(): Promise<boolean> {
    // Simulate a realistic 3s scan time.
    return delaySeconds(this.host, 3.0).then(() => true)
  }

  analyze(device: Device): Promise<AnalyzeResult> {
    return delaySeconds(this.host, 5.0).then((): AnalyzeResult => {
      // Dynamically inject the mock problems to simulate analysis discovering new issues.
      const problems = MOCK_PROBLEMS[device.hostname]
      if (problems) {
        if (!device.ar_summary) device.ar_summary = {} as any
        device.ar_summary.problems = problems
        return { ok: true, device }
      }
      return { ok: true, device: null }
    })
  }

  approveAction(req: ApproveActionRequest): Promise<ActionResult> {
    return delaySeconds(this.host, 2.0).then((): ActionResult => ({ ok: true }))
  }

  learn(topic: string, context: string): Promise<string> {
    return delaySeconds(this.host, 2.0).then(() =>
      "This is a simulated AI explanation for demo mode.\n\n" +
      `You requested info about: ${topic}\n` +
      "In a real environment, this data is fetched from the Underlayer backend using an LLM to explain the vulnerability or open port in context.\n\n" +
      "Risk has been flagged as moderate. Proceed with caution."
    )
  }
}
