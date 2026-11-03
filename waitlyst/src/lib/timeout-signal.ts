/**
 * An AbortSignal that fires after `ms`. AbortSignal.timeout is missing on
 * older Safari (iOS < 16): without a fallback a fetch stuck on a dead
 * connection never settles, and every poll guarded on "one in flight" stops
 * for good while the page keeps looking current.
 */
export function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms)
  }
  if (typeof AbortController === "undefined") return undefined
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}
