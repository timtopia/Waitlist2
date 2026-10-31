import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ConfirmModal } from "@/components/ui/ConfirmModal"

describe("ConfirmModal", () => {
  it("is a labelled dialog that Escape closes, with focus on the confirm button", () => {
    const onCancel = vi.fn()
    render(
      <ConfirmModal open title="Remove Alice?" message="She'll be told." onConfirm={vi.fn()} onCancel={onCancel} />
    )

    const dialog = screen.getByRole("dialog", { name: "Remove Alice?" })
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus()

    fireEvent.keyDown(document, { key: "Escape" })
    expect(onCancel).toHaveBeenCalled()
  })

  it("ignores Escape while the action is running", () => {
    const onCancel = vi.fn()
    render(<ConfirmModal open isLoading title="Deleting" message="..." onConfirm={vi.fn()} onCancel={onCancel} />)

    fireEvent.keyDown(document, { key: "Escape" })
    expect(onCancel).not.toHaveBeenCalled()
  })
})
