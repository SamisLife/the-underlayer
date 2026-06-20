/**
 * LiveDeviceDataSource.ts
 * Talks to the real FastAPI backend over HTTP. The request URLs, methods, JSON bodies, and
 * log messages are lifted verbatim from the original inline calls in DeviceListPanel /
 * DeviceDetailPanel, so live traffic and developer logs are unchanged.
 */

import NativeLogger from "SpectaclesInteractionKit.lspkg/Utils/NativeLogger"
import {Device} from "../Data/DeviceTypes"
import {normalizeDevice} from "../Data/DeviceParser"
import {HttpClient} from "../Net/HttpClient"
import {delaySeconds} from "../Util/Async"
import {IDeviceDataSource, ApproveActionRequest, AnalyzeResult, ActionResult} from "./IDeviceDataSource"

const log = new NativeLogger("UnderlayerList3D")

const ENDPOINT_DEVICES = "/api/devices/ar"
const ENDPOINT_SCAN = "/api/scan/trigger"
const ENDPOINT_APPROVE = "/api/approve-action"
const ENDPOINT_LEARN = "/api/learn"

export class LiveDeviceDataSource implements IDeviceDataSource {
  readonly isLive = true

  constructor(private readonly http: HttpClient, private readonly host: ScriptComponent) {}

  getDevices(): Promise<Device[]> {
    return this.http.get(ENDPOINT_DEVICES).then(
      (res) => {
        if (res.status === 200) {
          try {
            const data = JSON.parse(res.body)
            if (Array.isArray(data)) return data as Device[]
            log.w(`API returned 200 but data is not an array: ${res.body}`)
          } catch (e) {
            log.w(`Failed to parse HttpResponse body: ${e}. Body was: ${res.body}`)
          }
          throw new Error("invalid-devices-payload")
        }
        log.e(`Polling failed! Status: ${res.status}. Please check Windows Firewall if status is 0!`)
        throw new Error(`poll-failed-${res.status}`)
      },
      (err) => {
        log.e(`HTTP Polling catch block error: ${err}`)
        throw err
      }
    )
  }

  triggerScan(): Promise<boolean> {
    return this.http.post(ENDPOINT_SCAN).then(
      (res) => {
        if (res.status === 200) {
          log.d(`Scan complete! Backend response: ${res.body}`)
          // Preserve the artificial 3s settle before signalling completion.
          return delaySeconds(this.host, 3.0).then(() => true)
        }
        log.e(`Scan trigger failed with status ${res.status}. Body: ${res.body}`)
        return false
      },
      (err) => {
        log.e(`HTTP trigger catch block error: ${err}`)
        return false
      }
    )
  }

  analyze(device: Device): Promise<AnalyzeResult> {
    return this.http.post(`/api/analyze/${device.hostname}`).then(
      (res): AnalyzeResult => {
        if (res.status === 200) {
          try {
            const data = JSON.parse(res.body)
            if (data.arSummary) {
              return { ok: true, device: normalizeDevice(data.arSummary) }
            }
          } catch (e) {
            print(`Failed to parse updated device: ${e}`)
          }
          return { ok: true, device: null }
        }
        return { ok: false, reason: "failed" }
      },
      (): AnalyzeResult => ({ ok: false, reason: "error" })
    )
  }

  approveAction(req: ApproveActionRequest): Promise<ActionResult> {
    return this.http.post(ENDPOINT_APPROVE, {
      hostname: req.hostname,
      actionLabel: req.actionLabel,
      command: req.command,
      approved: true
    }).then(
      (res): ActionResult => (res.status === 200 ? { ok: true } : { ok: false, reason: "failed" }),
      (): ActionResult => ({ ok: false, reason: "error" })
    )
  }

  learn(topic: string, context: string): Promise<string> {
    return this.http.post(ENDPOINT_LEARN, { topic: topic, context: context || "" }).then(
      (res) => {
        if (res.status === 200) {
          try {
            const data = JSON.parse(res.body)
            return data.info || "No explanation returned."
          } catch (e) {
            return `PARSE ERROR: ${res.body}`
          }
        }
        return `API ERROR: ${res.status}\n${res.body}`
      },
      () => "NETWORK EXCEPTION"
    )
  }
}
