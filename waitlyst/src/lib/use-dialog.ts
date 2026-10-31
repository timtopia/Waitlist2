"use client"

import { useEffect, useRef } from "react"

/**
 * Keyboard behaviour for a modal: Escape closes it, focus moves into it when
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
    const target = container?.querySelector<HTMLElement>("[data-autofocus]")
      ?? container?.querySelector<HTMLElement>("button:not([disabled]), [href], input, select, textarea")
    target?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open])

  return containerRef
}
