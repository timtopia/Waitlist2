"use client"

import { ButtonHTMLAttributes, forwardRef } from "react"
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./buttonStyles"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "primary", size = "md", isLoading, children, disabled, onClick, ...props }, ref) => {
    return (
      <button
        ref={ref}
        // Loading stays focusable: disabling the focused button would drop
        // keyboard focus to the top of the page, and it wouldn't come back.
        // Clicks are ignored instead, and it looks disabled.
        className={buttonClasses({ variant, size, className: `${isLoading && !disabled ? "opacity-50 cursor-wait " : ""}${className}` })}
        disabled={disabled}
        aria-disabled={(isLoading && !disabled) || undefined}
        aria-busy={isLoading || undefined}
        {...props}
        onClick={(e) => {
          if (isLoading) {
            e.preventDefault()
            return
          }
          onClick?.(e)
        }}
      >
        {isLoading && (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4" aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = "Button"
