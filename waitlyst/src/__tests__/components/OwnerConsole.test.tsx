import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OwnerConsole } from "@/components/OwnerConsole"

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

const { addToastMock } = vi.hoisted(() => ({ addToastMock: vi.fn() }))
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast: addToastMock }) }))

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

function pos(id: string, position: number, name: string, fulfilled = false) {
  return { id, position, fulfilled, lockedUntil: null, user: { id: `u-${id}`, name } }
}

function respond(routes: Record<string, unknown>) {
  fetchMock.mockImplementation((url: string) => {
    const key = Object.keys(routes).find((k) => url.endsWith(k))
    const body = key ? routes[key] : {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  })
}

const baseProps = {
  lineId: "line-1",
  isActive: true,
  nowServingUserId: null as string | null,
  ownerFeePercent: 10,
  stripeEnabled: false,
  hasPayoutSetup: false,
  onChanged: vi.fn(),
}

describe("OwnerConsole", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    respond({ "/stats": { ownerFeeEarned: 5, ownerFeePending: 2 } })
  })

  it("skips served people when showing who is up next", () => {
    render(
      <OwnerConsole
        {...baseProps}
        positions={[pos("p1", 1, "Alice", true), pos("p2", 2, "Bob"), pos("p3", 3, "Cara")]}
      />
    )
    expect(screen.getByText("Up next")).toBeInTheDocument()
    expect(screen.getByText("Bob")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Call Bob" })).toBeInTheDocument()
    expect(screen.getByText("2 waiting")).toBeInTheDocument()
    expect(screen.getByText("1 served")).toBeInTheDocument()
  })

  it("serves the called person and calls the next one in one click", async () => {
    respond({ "/fulfill": { fulfilled: true }, "/call-next": { calledUser: "Cara" }, "/stats": {} })
    const onChanged = vi.fn()
    render(
      <OwnerConsole
        {...baseProps}
        nowServingUserId="u-p2"
        onChanged={onChanged}
        positions={[pos("p2", 1, "Bob"), pos("p3", 2, "Cara")]}
      />
    )
    expect(screen.getByText("Now serving")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Done · Call Next" }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const calls = fetchMock.mock.calls.map((c) => [c[0], c[1]?.body])
    expect(calls).toContainEqual(["/api/lines/line-1/fulfill", JSON.stringify({ positionId: "p2" })])
    expect(calls.map((c) => c[0])).toContain("/api/lines/line-1/call-next")
    const fulfillIdx = calls.findIndex((c) => c[0] === "/api/lines/line-1/fulfill")
    const callIdx = calls.findIndex((c) => c[0] === "/api/lines/line-1/call-next")
    expect(fulfillIdx).toBeLessThan(callIdx)
  })

  it("does not call anyone if marking served fails", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/fulfill")
          ? { ok: false, json: () => Promise.resolve({ error: "locked" }) }
          : { ok: true, json: () => Promise.resolve({}) }
      )
    )
    render(
      <OwnerConsole {...baseProps} nowServingUserId="u-p2" positions={[pos("p2", 1, "Bob"), pos("p3", 2, "Cara")]} />
    )
    fireEvent.click(screen.getByRole("button", { name: "Done · Call Next" }))
    await waitFor(() => expect(baseProps.onChanged).toHaveBeenCalled())
    expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain("/api/lines/line-1/call-next")
  })

  it("clears served people via batch-remove with payout after confirming", async () => {
    respond({ "/batch-remove": { removed: 1, failed: 0 }, "/stats": {} })
    render(<OwnerConsole {...baseProps} positions={[pos("p1", 1, "Alice", true), pos("p2", 2, "Bob")]} />)

    fireEvent.click(screen.getByText("Clear served"))
    fireEvent.click(screen.getByRole("button", { name: "Clear Served" }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/lines/line-1/batch-remove",
        expect.objectContaining({ body: JSON.stringify({ positionIds: ["p1"], action: "payout" }) })
      )
    )
  })

  it("shows the owner's fee earnings with a link to settlement", async () => {
    render(<OwnerConsole {...baseProps} positions={[]} />)
    await waitFor(() => expect(screen.getByText(/\$5\.00 earned/)).toBeInTheDocument())
    expect(screen.getByText(/\$2\.00 pending/)).toBeInTheDocument()
    expect(screen.getByText(/Settlement/).closest("a")).toHaveAttribute("href", "/lines/line-1/settlement")
  })

  it("offers payout setup only when Stripe is configured and the owner isn't connected", () => {
    const { rerender } = render(<OwnerConsole {...baseProps} stripeEnabled positions={[]} />)
    expect(screen.getByRole("button", { name: "Set Up Payouts" })).toBeInTheDocument()

    rerender(<OwnerConsole {...baseProps} stripeEnabled hasPayoutSetup positions={[]} />)
    expect(screen.queryByRole("button", { name: "Set Up Payouts" })).not.toBeInTheDocument()

    rerender(<OwnerConsole {...baseProps} stripeEnabled={false} positions={[]} />)
    expect(screen.queryByRole("button", { name: "Set Up Payouts" })).not.toBeInTheDocument()
  })

  it("prompts to share right after the line is created", () => {
    render(<OwnerConsole {...baseProps} justCreated positions={[]} />)
    expect(screen.getByText(/Your line is live/)).toBeInTheDocument()
    expect(screen.getByLabelText("Line link")).toHaveValue(`${window.location.origin}/lines/line-1`)
  })

  it("tells the host to call a walk-in out at the stand", async () => {
    respond({ "/call-next": { calledUser: "Dana", isWalkIn: true }, "/stats": {} })
    render(<OwnerConsole {...baseProps} positions={[pos("p1", 1, "Dana")]} />)
    fireEvent.click(screen.getByRole("button", { name: "Call Dana" }))
    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith("Dana is a walk-in -- call them out at the stand", "success")
    )
  })

  it("shows a called party's time left and gives them 5 more minutes", async () => {
    respond({ "/grace": {}, "/stats": {} })
    const called = {
      ...pos("p1", 1, "Bob"),
      calledAt: new Date(Date.now() - 60_000).toISOString(),
    }
    render(<OwnerConsole {...baseProps} responseWindowMinutes={10} positions={[called, pos("p2", 2, "Cara")]} />)
    expect(screen.getByText(/9 min left to show up/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Give Bob 5 more minutes" }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/lines/line-1/grace",
        expect.objectContaining({ body: JSON.stringify({ positionId: "p1" }) })
      )
    )
  })

  it("shows no countdown for walk-ins or while paused", () => {
    const calledAt = new Date().toISOString()
    const walkIn = { ...pos("p1", 1, "Bob"), calledAt, user: { id: "u-p1", name: "Bob", isWalkIn: true } }
    const { rerender } = render(<OwnerConsole {...baseProps} responseWindowMinutes={10} positions={[walkIn]} />)
    expect(screen.queryByText(/left to show up/)).not.toBeInTheDocument()
    rerender(
      <OwnerConsole {...baseProps} isActive={false} responseWindowMinutes={10} positions={[{ ...pos("p1", 1, "Bob"), calledAt }]} />
    )
    expect(screen.queryByText(/left to show up/)).not.toBeInTheDocument()
  })

  it("lists other called parties with seat and no-show actions", async () => {
    respond({ "/fulfill": {}, "/remove-position": {}, "/stats": {} })
    const calledAt = new Date().toISOString()
    render(
      <OwnerConsole
        {...baseProps}
        isRestaurant
        positions={[
          { ...pos("p1", 1, "Bob"), calledAt },
          pos("p2", 2, "Cara"),
          { ...pos("p3", 3, "Dana"), calledAt, partySize: 4, response: "ON_MY_WAY" as const },
        ]}
      />
    )
    expect(screen.getByText("Also called:")).toBeInTheDocument()
    expect(screen.getByText(/Dana \(party of 4\)/)).toBeInTheDocument()
    expect(screen.queryByText(/Cara \(party of/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Mark Seated: Dana" }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/lines/line-1/fulfill",
        expect.objectContaining({ body: JSON.stringify({ positionId: "p3" }) })
      )
    )
    await waitFor(() => expect(screen.getByRole("button", { name: "No-show: Dana" })).not.toBeDisabled())
    fireEvent.click(screen.getByRole("button", { name: "No-show: Dana" }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/lines/line-1/remove-position",
        expect.objectContaining({ body: JSON.stringify({ positionId: "p3", action: "payout", noShow: true }) })
      )
    )
  })

  it("counts only waiting parties when closing for the night", () => {
    render(
      <OwnerConsole
        {...baseProps}
        isRestaurant
        positions={[pos("p1", 1, "Alice", true), pos("p2", 2, "Bob"), pos("p3", 3, "Cara")]}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Close for the night" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("removing the 2 parties still waiting")
  })

  it("returns focus to the walk-in button when the form closes", async () => {
    render(<OwnerConsole {...baseProps} positions={[]} />)
    fireEvent.click(screen.getByText("+ Add walk-in"))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.getByText("+ Add walk-in")).toHaveFocus())
  })

  it("toggles pause", async () => {
    respond({ "/pause": { isActive: false }, "/stats": {} })
    render(<OwnerConsole {...baseProps} positions={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Pause" }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/lines/line-1/pause", expect.objectContaining({ method: "POST" }))
    )
  })
})
