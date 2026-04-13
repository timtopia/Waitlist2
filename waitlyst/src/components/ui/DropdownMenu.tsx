"use client"

import { useState } from "react"

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
}

export function DropdownMenu({ items, separatorBefore = [] }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.preventDefault()
          setOpen(!open)
        }}
        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
            {items.map((item, index) => (
              <div key={index}>
                {separatorBefore.includes(index) && (
                  <div className="border-t border-gray-100 my-1" />
                )}
                <button
                  onClick={() => {
                    item.onClick()
                    setOpen(false)
                  }}
                  disabled={item.disabled}
                  className={`w-full text-left px-4 py-2 text-sm disabled:opacity-50 ${
                    item.variant === "danger"
                      ? "text-red-600 hover:bg-red-50"
                      : "text-gray-700 hover:bg-gray-50"
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
