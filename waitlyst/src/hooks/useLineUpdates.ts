"use client"

import { useEffect } from "react"

export type LineUpdateEvent = {
  type: "join" | "leave" | "price-change" | "swap" | "connected"
  lineId?: string
}

export function useLineUpdates(lineId: string, onUpdate: (event: LineUpdateEvent) => void) {
  useEffect(() => {
    const eventSource = new EventSource(`/api/lines/${lineId}/events`)

    eventSource.onmessage = (event) => {
      try {
        const data: LineUpdateEvent = JSON.parse(event.data)
        if (data.type !== "connected") {
          onUpdate(data)
        }
      } catch (e) {
        console.error("Failed to parse SSE message:", e)
      }
    }

    eventSource.onerror = () => {
      // EventSource will automatically reconnect
      console.log("SSE connection error, reconnecting...")
    }

    return () => {
      eventSource.close()
    }
  }, [lineId, onUpdate])
}
