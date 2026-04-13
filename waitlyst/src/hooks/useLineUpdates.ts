"use client"

import { useEffect, useRef, useCallback } from "react"

export type LineUpdateEvent = {
  type: "join" | "leave" | "price-change" | "swap" | "connected" | "delete" | "lock" | "poll-update"
  lineId?: string
  userName?: string
  position?: number
  data?: unknown // Fresh line data from poll (avoids double-fetch)
}

const POLL_INTERVAL_MS = 30000 // 30 seconds (reduced from 5s to save DB compute)

/**
 * Subscribe to line updates via polling.
 *
 * Polls every 30 seconds and only when the tab is visible.
 * Pauses automatically when the user switches tabs.
 *
 * SSE was removed — on Vercel serverless, SSE events fired from API routes
 * can't reach the SSE connection because each request runs in a separate
 * invocation with its own memory. Polling is the reliable approach.
 */
export function useLineUpdates(lineId: string, onUpdate: (event: LineUpdateEvent) => void) {
  const lastSnapshotRef = useRef<string | null>(null)
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  const stableOnUpdate = useCallback((event: LineUpdateEvent) => {
    onUpdateRef.current(event)
  }, [])

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      // Skip polling when tab is hidden
      if (document.visibilityState === "hidden") return

      try {
        const res = await fetch(`/api/lines/${lineId}`, {
          cache: "no-store",
        })
        if (res.ok) {
          const text = await res.text()
          if (lastSnapshotRef.current !== null && lastSnapshotRef.current !== text) {
            const parsed = JSON.parse(text)
            stableOnUpdate({ type: "poll-update", data: parsed })
          }
          lastSnapshotRef.current = text
        }
      } catch {
        // Silently ignore polling errors
      }
    }

    function startPolling() {
      if (!interval) {
        // Do an immediate poll when tab becomes visible again
        poll()
        interval = setInterval(poll, POLL_INTERVAL_MS)
      }
    }

    function stopPolling() {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        startPolling()
      } else {
        stopPolling()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    // Initial baseline after a short delay, then start polling
    const startTimeout = setTimeout(startPolling, 2000)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      clearTimeout(startTimeout)
      stopPolling()
    }
  }, [lineId, stableOnUpdate])
}
