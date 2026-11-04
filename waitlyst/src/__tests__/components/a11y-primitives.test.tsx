import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AnimatedStat } from "@/components/AnimatedStat"
import { Input, Textarea } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { ShareLine } from "@/components/ShareLine"
import { EmbedWidgetClient } from "@/app/lines/[lineId]/embed/EmbedWidgetClient"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("AnimatedStat", () => {
  it("shows the final number at once when the user prefers reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }))
    render(<AnimatedStat value={1234} label="Active lines" />)
    expect(await screen.findByText("1,234", { selector: "[aria-hidden]" })).toBeInTheDocument()
  })

  it("gives screen readers the real figure rather than the counting one", () => {
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} })
    render(<AnimatedStat value={42} label="People in queues" />)
    expect(screen.getByText("42 People in queues")).toHaveClass("sr-only")
  })
})

describe("Input", () => {
  it("ties the label and error to the field even without an id", () => {
    render(<><Input label="Line name" error="Required" /><Textarea label="About" error="Too long" /></>)
    const input = screen.getByLabelText("Line name")
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input).toHaveAccessibleDescription("Required")
    expect(screen.getByLabelText("About")).toHaveAccessibleDescription("Too long")
  })
})

describe("Button", () => {
  it("marks itself busy while loading", () => {
    render(<Button isLoading>Save</Button>)
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-busy", "true")
  })

  it("stays focusable while loading but ignores clicks", () => {
    const onClick = vi.fn()
    render(<Button isLoading onClick={onClick}>Join</Button>)
    const button = screen.getByRole("button", { name: "Join" })
    // Disabling the focused button would drop keyboard focus to the page
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe("ShareLine", () => {
  it("keeps keyboard focus when opening and hiding the QR code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<svg></svg>")))
    render(<ShareLine lineId="l1" lineName="Joe's" />)
    fireEvent.click(screen.getByRole("button", { name: "Share" }))
    fireEvent.click(screen.getByRole("button", { name: "QR Code" }))
    expect(screen.getByRole("button", { name: "Hide QR code" })).toHaveFocus()
    fireEvent.click(screen.getByRole("button", { name: "Hide QR code" }))
    expect(screen.getByRole("button", { name: "QR Code" })).toHaveFocus()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it("gives the embed iframe an escaped title", () => {
    render(<ShareLine lineId="l1" lineName={`Joe's "Diner"`} canEmbed />)
    fireEvent.click(screen.getByRole("button", { name: "Share" }))
    fireEvent.click(screen.getByRole("button", { name: "Embed Widget" }))
    expect(screen.getByRole("button", { name: "Hide embed code" })).toHaveFocus()
    expect((screen.getByLabelText("Iframe Embed") as HTMLTextAreaElement).value).toContain(
      'title="Joe\'s &quot;Diner&quot; waitlist"'
    )
  })
})

describe("EmbedWidgetClient", () => {
  it("has a main landmark and says the join link opens a new tab", () => {
    render(
      <EmbedWidgetClient
        lineId="l1"
        lineName="Joe's"
        productName={null}
        productImage={null}
        productPrice={null}
        positionCount={3}
        maxCapacity={null}
        isFull={false}
        opensAt={null}
        closesAt={null}
        nowServing="A12"
        hideCapacity={false}
        kind="RESTAURANT"
        isActive
        capacityUsed={3}
      />
    )
    expect(screen.getByRole("main")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Join Line \(opens in a new tab\)/ })).toBeInTheDocument()
    // The live region wraps the card and stays mounted when nothing is being served
    expect(screen.getByText("Now Serving: A12").parentElement?.parentElement).toHaveAttribute("aria-live", "polite")
  })
})
