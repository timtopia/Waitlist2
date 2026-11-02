import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { LineStatusBanner } from "@/components/LineStatusBanner"

const past = new Date(Date.now() - 60_000).toISOString()
const soon = new Date(Date.now() + 10 * 60_000).toISOString()

describe("LineStatusBanner", () => {
  it("reassures someone already waiting that closing doesn't drop them", () => {
    const { rerender } = render(
      <LineStatusBanner opensAt={null} closesAt={past} maxCapacity={null} currentCount={0} isFull={false} kind="RESTAURANT" />
    )
    expect(screen.getByText("This line is no longer accepting new joins.")).toBeInTheDocument()

    rerender(
      <LineStatusBanner opensAt={null} closesAt={past} maxCapacity={null} currentCount={0} isFull={false} kind="RESTAURANT" inLine />
    )
    expect(screen.getByText(/you're still in line and keep your place until you're seated/)).toBeInTheDocument()

    rerender(
      <LineStatusBanner opensAt={null} closesAt={soon} maxCapacity={null} currentCount={0} isFull={false} inLine />
    )
    expect(screen.getByText(/You keep your place after it closes/)).toBeInTheDocument()
  })

  it("doesn't tell a waiting party to check back when the line fills", () => {
    render(
      <LineStatusBanner opensAt={null} closesAt={null} maxCapacity={20} currentCount={20} isFull kind="RESTAURANT" inLine />
    )
    expect(screen.getByText(/You're already in line/)).toBeInTheDocument()
    expect(screen.queryByText(/check back soon/)).not.toBeInTheDocument()
  })
})
