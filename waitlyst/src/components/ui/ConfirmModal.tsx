"use client"

import { useId } from "react"
import { Button } from "./Button"
import { useDialog } from "@/lib/use-dialog"

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "danger" | "primary"
  isLoading?: boolean
  /** Which button starts focused. Defaults to Cancel for danger dialogs. */
  initialFocus?: "cancel" | "confirm"
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  isLoading = false,
  initialFocus,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const focusCancel = (initialFocus ?? (variant === "danger" ? "cancel" : "confirm")) === "cancel"
  const titleId = useId()
  const messageId = useId()
  const dialogRef = useDialog(open, () => {
    if (!isLoading) onCancel()
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        ref={dialogRef}
        role={variant === "danger" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="bg-white border border-ink max-w-md w-full animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              {variant === "danger" && (
                <p className="font-mono text-xs uppercase tracking-widest text-accent mb-2">Warning</p>
              )}
              <h3 id={titleId} className="text-lg font-semibold tracking-tight text-ink">{title}</h3>
              <p id={messageId} className="mt-2 text-sm text-ink/60">{message}</p>
            </div>
          </div>
        </div>
        <div className="px-6 pb-6 flex justify-end gap-3">
          {/* Destructive or final dialogs start on Cancel, so a reflexive Enter is safe */}
          <Button variant="ghost" onClick={onCancel} disabled={isLoading} data-autofocus={focusCancel || undefined}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            isLoading={isLoading}
            data-autofocus={!focusCancel || undefined}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
