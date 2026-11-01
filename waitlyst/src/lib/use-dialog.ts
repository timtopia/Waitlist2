"use client"

import { useEffect, useRef } from "react"

/**
 * Keyboard behaviour for a modal: Escape closes it, Tab stays inside it, focus moves into it when
 * it opens (onto the element given the returned ref, else the first
 * button), and returns to whatever had focus before when it closes.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void) {
  const containerRef = useRef<T>(null)
  // Latest onClose without re-running the open/close effect on every render
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const container = containerRef.current
    const focusable = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
    const target = container?.querySelector<HTMLElement>("[data-autofocus]")
      ?? container?.querySelector<HTMLElement>(focusable)
    target?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current()
      if (event.key === "Tab" && container) {
        const items = container.querySelectorAll<HTMLElement>(focusable)
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (event.shiftKey && (active === first || !container.contains(active))) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (active === last || !container.contains(active))) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open])

  return containerRef
}
