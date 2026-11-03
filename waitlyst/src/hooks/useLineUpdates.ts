"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import { timeoutSignal } from "@/lib/timeout-signal"

export type LineUpdateEvent = {
  type: "join" | "leave" | "price-change" | "swap" | "connected" | "delete" | "lock" | "poll-update"
  lineId?: string
  userName?: string
  position?: number
  data?: unknown // Fresh line data from poll (avoids double-fetch)
}

const POLL_INTERVAL_MS = 30000 // 30 seconds (reduced from 5s to save DB compute)
/** A poll stuck on a dead connection would otherwise block every later one */
const POLL_TIMEOUT_MS = 10_000

function pollSignal(): AbortSignal | undefined {
  return timeoutSignal(POLL_TIMEOUT_MS)
}

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
 *
 * Returns `stale: true` while polls are failing (e.g. the phone lost signal),
 * so the page can say it's out of date instead of looking current.
 */
export function useLineUpdates(
  lineId: string,
  onUpdate: (event: LineUpdateEvent) => void,
  { intervalMs = POLL_INTERVAL_MS, pollWhenHidden = false }: LineUpdateOptions = {}
) {
  const [stale, setStale] = useState(false)
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
    // Visibility and "online" also trigger polls; never run two at once, or a
    // slow older response could land after a newer one.
    let inFlight = false
    // Back off after errors and honor Retry-After: at a venue where every
    // guest shares one IP, polling at full speed through a rate limit keeps
    // everyone limited and nobody sees their turn
    let skipUntil = 0
    let failures = 0
    const backOff = () => {
      failures += 1
      if (failures >= 2) skipUntil = Date.now() + Math.min(60_000, intervalMs * 2 ** (failures - 1))
    }

    const poll = async () => {
      if (document.visibilityState === "hidden" && !pollWhenHidden) return
      if (inFlight || Date.now() < skipUntil) return
      inFlight = true

      try {
        const res = await fetch(`/api/lines/${lineId}`, {
          cache: "no-store",
          // Unchanged since the last poll: the server answers 304 with no body
          headers: etagRef.current ? { "If-None-Match": etagRef.current } : undefined,
          signal: pollSignal(),
        })
        // A server error or a rate limit says nothing about the line; what's
        // shown is out of date, and someone relying on it to see their turn
        // coming shouldn't be told otherwise
        if (res.status === 429) {
          setStale(true)
          const retryAfter = Number(res.headers.get("Retry-After"))
          skipUntil = Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000)
          return
        }
        if (res.status >= 500) {
          setStale(true)
          backOff()
          return
        }
        failures = 0
        skipUntil = 0
        setStale(false)
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
        setStale(true)
        backOff()
      } finally {
        inFlight = false
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

    // Catch up the moment the connection returns, not at the next tick
    const handleOnline = () => {
      skipUntil = 0
      poll()
    }
    const handleOffline = () => setStale(true)

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    // Initial baseline after a short delay, then start polling
    // A page opened in a background tab (say, from an email link) waits for
    // its first view instead: started now, polling would idle until the next
    // tick and the page could show a stale turn for up to a full interval
    // after they switch to it.
    const startTimeout = setTimeout(() => {
      if (pollWhenHidden || document.visibilityState === "visible") startPolling()
    }, 2000)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      clearTimeout(startTimeout)
      stopPolling()
    }
  }, [lineId, stableOnUpdate, intervalMs, pollWhenHidden])

  // A different line's ETag means nothing here
  useEffect(() => {
    etagRef.current = null
    lastSnapshotRef.current = null
  }, [lineId])

  return { stale }
}
