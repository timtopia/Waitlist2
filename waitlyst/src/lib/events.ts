// Simple event emitter for server-side events (SSE)

interface LineEvent {
  type: "join" | "leave" | "price-change" | "swap" | "delete" | "lock"
  lineId?: string
  userName?: string
  position?: number
}

type Listener = (data: LineEvent) => void

class LineEventEmitter {
  private listeners: Map<string, Set<Listener>> = new Map()

  subscribe(lineId: string, listener: Listener) {
    if (!this.listeners.has(lineId)) {
      this.listeners.set(lineId, new Set())
    }
    this.listeners.get(lineId)!.add(listener)

    return () => {
      this.listeners.get(lineId)?.delete(listener)
      if (this.listeners.get(lineId)?.size === 0) {
        this.listeners.delete(lineId)
      }
    }
  }

  emit(lineId: string, data: LineEvent) {
    this.listeners.get(lineId)?.forEach((listener) => {
      try {
        listener(data)
      } catch (e) {
        console.error("Event listener error:", e)
      }
    })
  }
}

// Global singleton
const globalForEvents = globalThis as unknown as { lineEvents: LineEventEmitter }
export const lineEvents = globalForEvents.lineEvents || new LineEventEmitter()
if (process.env.NODE_ENV !== "production") globalForEvents.lineEvents = lineEvents
