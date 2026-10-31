import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { BarChart } from "@/components/BarChart"

const bars = [
  { label: "9a", value: 3, display: "3 joins" },
  { label: "10a", value: 0, display: "0 joins" },
  { label: "11a", value: 7, display: "7 joins" },
]

describe("BarChart", () => {
  it("names every bar for keyboard and screen-reader users and shows a tooltip on focus", () => {
    render(<BarChart title="Busiest hours" bars={bars} labelHeader="Hour" valueHeader="Joins" />)

    const bar = screen.getByRole("button", { name: "11a: 7 joins" })
    fireEvent.focus(bar)
    expect(screen.getByRole("status")).toHaveTextContent("11a · 7 joins")
  })

  it("switches to a table of the same numbers", () => {
    render(<BarChart title="Busiest hours" bars={bars} labelHeader="Hour" valueHeader="Joins" />)

    fireEvent.click(screen.getByText("Show table"))
    expect(screen.getByRole("columnheader", { name: "Hour" })).toBeInTheDocument()
    expect(screen.getByText("7 joins")).toBeInTheDocument()
  })
})
