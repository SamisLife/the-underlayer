/**
 * HttpClient.ts
 * Thin Promise wrapper over LensStudio's InternetModule + a single place to derive the
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
    return this.request(path, RemoteServiceHttpRequest.HttpRequestMethod.Get)
  }

  post(path: string, jsonBody: object = {}): Promise<HttpResult> {
    return this.request(path, RemoteServiceHttpRequest.HttpRequestMethod.Post, jsonBody)
  }

  private request(path: string, method: any, jsonBody?: object): Promise<HttpResult> {
    return new Promise<HttpResult>((resolve, reject) => {
      try {
        const request = RemoteServiceHttpRequest.create()
        request.url = `${this.baseUrl}${path}`
        request.method = method
        if (jsonBody !== undefined) {
          request.setHeader("Content-Type", "application/json")
          request.body = JSON.stringify(jsonBody)
        }
        this.internetModule.performHttpRequest(request, (response: RemoteServiceHttpResponse) => {
          resolve({ status: response.statusCode, body: response.body })
        })
      } catch (e) {
        reject(e)
      }
    })
  }
}
