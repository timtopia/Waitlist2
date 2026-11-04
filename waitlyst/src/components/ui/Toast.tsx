"use client"

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react"

type ToastType = "success" | "error" | "info" | "warning"

interface Toast {
  id: string
  message: string
  type: ToastType
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within ToastProvider")
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const removeToast = useCallback((id: string) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  /** Errors need reading and acting on, so they stay up longer */
  const startTimer = useCallback((id: string, type: ToastType) => {
    clearTimeout(timers.current.get(id))
    timers.current.set(id, setTimeout(() => removeToast(id), type === "error" ? 9000 : 5000))
  }, [removeToast])

  // Hovering or focusing a toast holds it, so slow readers and people
  // panning a zoomed screen don't lose it mid-sentence
  const holdToast = useCallback((id: string) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
  }, [])

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message, type }])
    startTimer(id, type)
  }, [startTimer])

  const icons: Record<ToastType, string> = {
    success: "M5 13l4 4L19 7",
    error: "M6 18L18 6M6 6l12 12",
    warning: "M12 9v2m0 4h.01M12 3l9.66 16.5H2.34L12 3z",
    info: "M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z",
  }

  const styles: Record<ToastType, string> = {
    success: "bg-green-700",
    error: "bg-accent",
    // amber-600 under white 14px text was ~3:1; amber-800 clears AA
    warning: "bg-amber-800",
    info: "bg-ink",
  }

  function renderToast(toast: Toast) {
    return (
      <div
        key={toast.id}
        onMouseEnter={() => holdToast(toast.id)}
        onMouseLeave={() => startTimer(toast.id, toast.type)}
        onFocus={() => holdToast(toast.id)}
        onBlur={() => startTimer(toast.id, toast.type)}
        className={`pointer-events-auto flex items-center gap-3 px-4 py-3 text-white text-sm font-medium animate-slide-in-right ${styles[toast.type]}`}
      >
        <svg className="w-5 h-5 flex-shrink-0" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icons[toast.type]} />
        </svg>
        <span className="flex-1 min-w-0 break-words">{toast.message}</span>
        <button
          onClick={() => {
            // The button is about to disappear: don't drop focus to the page body
            document.getElementById("main-content")?.focus({ preventScroll: true })
            removeToast(toast.id)
          }}
          className="flex-shrink-0 p-2.5 -my-2.5 -mr-2.5 ml-0 inline-flex items-center justify-center text-white/80 hover:text-white focus-visible:outline-white"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Toast containers stay mounted so screen readers pick up new
          messages: errors interrupt, everything else waits its turn. */}
      {/* toast-stack: lifted above the batch-select action bar (globals.css) */}
      <div className="toast-stack fixed bottom-4 left-4 right-4 sm:left-auto sm:max-w-sm z-[100] flex flex-col gap-2 pointer-events-none">
        <div aria-live="polite" className="flex flex-col gap-2">
          {toasts.filter((t) => t.type !== "error").map(renderToast)}
        </div>
        <div role="alert" className="flex flex-col gap-2">
          {toasts.filter((t) => t.type === "error").map(renderToast)}
        </div>
      </div>
    </ToastContext.Provider>
  )
}
