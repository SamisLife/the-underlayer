/**
 * Async.ts
 * Promise helpers for Lens Studio, which has no setTimeout. delaySeconds wraps a
 * DelayedCallbackEvent created on a host ScriptComponent so simulated/network delays can be
 * awaited like normal Promises.
 */

export function delaySeconds(host: ScriptComponent, seconds: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const ev = host.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    ev.bind(() => resolve())
    ev.reset(seconds)
  })
}
