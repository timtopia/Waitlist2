"use client"

import { useEffect } from "react"

/**
 * Keep the screen on while `active`. A locked phone stops the page from
 * checking the line, so a guest near the front would miss being called.
 * Browsers drop the lock whenever the tab is hidden; it's taken again when
 * the page is back in view.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return
      try {
        const next = await navigator.wakeLock.request("screen")
        if (cancelled) next.release().catch(() => {})
        else lock = next
      } catch {
        // Low battery mode or a browser that refuses: the page still works
      }
    }

    acquire()
    document.addEventListener("visibilitychange", acquire)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", acquire)
      lock?.release().catch(() => {})
    }
  }, [active])
}
