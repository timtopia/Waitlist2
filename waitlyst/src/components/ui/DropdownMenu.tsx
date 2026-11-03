"use client"

import { useEffect, useRef, useState } from "react"

export interface DropdownMenuItem {
  label: string
  onClick: () => void
  variant?: "default" | "danger"
  disabled?: boolean
}

interface DropdownMenuProps {
  items: DropdownMenuItem[]
  /** Optional separator indices -- insert a divider before these items */
  separatorBefore?: number[]
  /** What the "⋮" button is called for screen readers */
  label?: string
}

export function DropdownMenu({ items, separatorBefore = [], label = "More actions" }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Closing hands focus back to the "⋮" button, so keyboard users aren't
  // dropped at the top of the page when the menu unmounts.
  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const enabledItems = () =>
      Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])
    // Opening moves focus onto the first item, like a native menu
    enabledItems()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (!menuRef.current?.contains(document.activeElement)) return
      // Tabbing away closes the menu instead of leaving it open behind focus
      if (event.key === "Tab") {
        setOpen(false)
        return
      }
      const items = enabledItems()
      if (items.length === 0) return
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      let next: number | null = null
      if (event.key === "ArrowDown") next = (index + 1) % items.length
      else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length
      else if (event.key === "Home") next = 0
      else if (event.key === "End") next = items.length - 1
      if (next !== null) {
        event.preventDefault()
        items[next].focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.preventDefault()
          setOpen(!open)
        }}
        className="p-2 min-w-11 min-h-11 sm:min-w-0 pointer-fine:min-h-0 inline-flex items-center justify-center text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
      >
        <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div ref={menuRef} className="absolute right-0 top-full mt-1 w-48 bg-white border border-ink py-1 z-20" role="menu" aria-label={label}>
            {items.map((item, index) => (
              // Wrapper is presentational so the menu's children are just
              // menuitems/separators, as role="menu" requires
              <div key={index} role="none">
                {separatorBefore.includes(index) && (
                  <div role="separator" className="border-t border-rule my-1" />
                )}
                <button
                  role="menuitem"
                  onClick={() => {
                    // Close first, so an item that opens a dialog keeps focus
                    close()
                    item.onClick()
                  }}
                  disabled={item.disabled}
                  tabIndex={-1}
                  className={`w-full text-left px-4 py-2 min-h-11 pointer-fine:min-h-0 text-sm disabled:opacity-50 ${
                    item.variant === "danger"
                      ? "text-accent hover:bg-accent/5"
                      : "text-ink/80 hover:bg-ink/5"
                  }`}
                >
                  {item.label}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
