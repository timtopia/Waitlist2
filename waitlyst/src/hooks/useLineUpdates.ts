"use client"

import { useEffect, useRef, useCallback } from "react"

export type LineUpdateEvent = {
  type: "join" | "leave" | "price-change" | "swap" | "connected" | "delete" | "lock" | "poll-update"
  lineId?: string
  userName?: string
  position?: number
  data?: unknown // Fresh line data from poll (avoids double-fetch)
}

const POLL_INTERVAL_MS = 5000 // 5 seconds

/**
 * Subscribe to real-time line updates.
 *
 * Uses two strategies:
 * 1. SSE (Server-Sent Events) for instant updates — works on persistent servers
 * 2. Polling every 5 seconds as a reliable fallback — works on serverless (Vercel)
 *
 * On Vercel, SSE events fired from API routes don't reach the SSE connection
 * because each request runs in a separate serverless invocation with its own memory.
 * Polling ensures the UI always stays in sync regardless of infrastructure.
 */
export function useLineUpdates(lineId: string, onUpdate: (event: LineUpdateEvent) => void) {
  const lastSnapshotRef = useRef<string | null>(null)
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  const stableOnUpdate = useCallback((event: LineUpdateEvent) => {
    onUpdateRef.current(event)
  }, [])

  useEffect(() => {
    // ─── SSE: instant updates (works locally / persistent servers) ────
    let eventSource: EventSource | null = null
    try {
      eventSource = new EventSource(`/api/lines/${lineId}/events`)

      eventSource.onmessage = (event) => {
        try {
          const data: LineUpdateEvent = JSON.parse(event.data)
          if (data.type !== "connected") {
            stableOnUpdate(data)
          }
        } catch (e) {
          console.error("Failed to parse SSE message:", e)
        }
      }

      eventSource.onerror = () => {
        // EventSource will automatically reconnect
      }
    } catch {
      // SSE not supported or failed to connect — polling handles it
    }

    // ─── Polling: reliable fallback for serverless ───────────────────
    const poll = async () => {
      try {
        const res = await fetch(`/api/lines/${lineId}`, {
          cache: "no-store",
        })
        if (res.ok) {
          const text = await res.text()
          if (lastSnapshotRef.current !== null && lastSnapshotRef.current !== text) {
            // Data changed — send the fresh data directly to avoid a double-fetch
            const parsed = JSON.parse(text)
            stableOnUpdate({ type: "poll-update", data: parsed })
          }
          lastSnapshotRef.current = text
        }
      } catch {
        // Silently ignore polling errors
      }
    }

    // Initial baseline after a short delay
    const startTimeout = setTimeout(poll, 2000)
    const interval = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      eventSource?.close()
      clearTimeout(startTimeout)
      clearInterval(interval)
    }
  }, [lineId, stableOnUpdate])
}
