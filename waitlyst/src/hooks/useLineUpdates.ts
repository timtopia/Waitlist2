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

export interface LineUpdateOptions {
  intervalMs?: number
  /**
   * Keep polling while the tab is in the background. Needed for browser
   * notifications, which are only shown when the tab is hidden.
   */
  pollWhenHidden?: boolean
}

/**
 * Subscribe to line updates via polling.
 *
 * Polls every 30 seconds (or `intervalMs`), by default only while the tab is
 * visible.
 *
 * SSE was removed — on Vercel serverless, SSE events fired from API routes
 * can't reach the SSE connection because each request runs in a separate
 * invocation with its own memory. Polling is the reliable approach.
 */
export function useLineUpdates(
  lineId: string,
  onUpdate: (event: LineUpdateEvent) => void,
  { intervalMs = POLL_INTERVAL_MS, pollWhenHidden = false }: LineUpdateOptions = {}
) {
  const lastSnapshotRef = useRef<string | null>(null)
  const deletedRef = useRef(false)
  const etagRef = useRef<string | null>(null)
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  const stableOnUpdate = useCallback((event: LineUpdateEvent) => {
    onUpdateRef.current(event)
  }, [])

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      if (document.visibilityState === "hidden" && !pollWhenHidden) return

      try {
        const res = await fetch(`/api/lines/${lineId}`, {
          cache: "no-store",
          // Unchanged since the last poll: the server answers 304 with no body
          headers: etagRef.current ? { "If-None-Match": etagRef.current } : undefined,
        })
        if (res.status === 304) return
        // The line was there and now isn't: the organizer deleted it. Say so
        // once, rather than leaving the page frozen on its last snapshot.
        if (res.status === 404) {
          if (lastSnapshotRef.current !== null && !deletedRef.current) {
            deletedRef.current = true
            stableOnUpdate({ type: "delete", lineId })
          }
          return
        }
        if (res.ok) {
          etagRef.current = res.headers.get("ETag")
          const text = await res.text()
          // The first poll is always passed on: the page's own first load
          // happened before it, and anything that changed in between would
          // otherwise stay hidden until the line changed again. Callers diff
          // against what's on screen, so an unchanged line alerts no one.
          if (lastSnapshotRef.current !== text) {
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
        interval = setInterval(poll, intervalMs)
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
        if (pollWhenHidden) poll()
        else startPolling()
      } else if (!pollWhenHidden) {
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
  }, [lineId, stableOnUpdate, intervalMs, pollWhenHidden])

  // A different line's ETag means nothing here
  useEffect(() => {
    etagRef.current = null
    lastSnapshotRef.current = null
  }, [lineId])
}
