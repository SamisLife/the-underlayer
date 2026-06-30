/**
 * HttpClient.ts
 * Thin Promise wrapper over LensStudio's InternetModule Fetch API + a single place to derive the
 * backend base URL from the configured WebSocket URL. Replaces the ws://->http:// transform
 * that was previously duplicated across DeviceListPanel and DeviceDetailPanel.
 *
 * Every POST sends a JSON body (defaulting to `{}`) with a Content-Type header. This is
 * deliberate: on Spectacles, a body-less POST gets emitted as a GET, so bodyless calls like
 * triggerScan()/analyze() previously arrived at the backend as GET. Always sending a body
 * guarantees the request leaves the device as a real POST.
 */

export interface HttpResult {
  status: number
  body: string
}

export class HttpClient {
  private internetModule: any = require("LensStudio:InternetModule")

  constructor(private readonly baseUrl: string) {}

  /**
   * Convert the WebSocket endpoint into the HTTP API root.
   * e.g. ws://10.0.0.131:8000/ws/devices -> http://10.0.0.131:8000
   */
  static deriveBaseUrl(websocketUrl: string): string {
    return websocketUrl
      .replace("ws://", "http://")
      .replace("wss://", "https://")
      .replace("/ws/devices", "")
  }

  get hasBaseUrl(): boolean {
    return !!this.baseUrl
  }

  get(path: string): Promise<HttpResult> {
    return this.request(path, "GET")
  }

  post(path: string, jsonBody: object = {}): Promise<HttpResult> {
    return this.request(path, "POST", jsonBody)
  }

  private request(path: string, method: string, jsonBody?: object): Promise<HttpResult> {
    const options: any = {
      method,
      headers: {
        "Content-Type": "application/json"
      }
    }

    if (jsonBody !== undefined) {
      options.body = JSON.stringify(jsonBody)
    }

    return this.internetModule.fetch(`${this.baseUrl}${path}`, options).then((response: any) => {
      return response.text().then((body: string) => ({
        status: response.status,
        body
      }))
    })
  }
}
