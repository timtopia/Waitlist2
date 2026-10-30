import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemberStatusCard } from "@/components/MemberStatusCard"

const fetchMock = vi.fn()
global.fetch = fetchMock

function mockWaitTime(minutes: number | null) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ estimatedMinutesPerPerson: minutes, basedOn: minutes == null ? 0 : 3 }),
  })
}

const baseProps = {
  maxCapacity: null,
  totalPositions: 10,
  askingPrice: null,
  lineId: "line-1",
}

describe("MemberStatusCard", () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it("shows how many people are ahead and an estimate based on them", async () => {
    mockWaitTime(4)
    render(<MemberStatusCard {...baseProps} status={{ phase: "waiting", position: 5, ahead: 3 }} />)
    expect(screen.getByText("3 people ahead of you")).toBeInTheDocument()
    expect(await screen.findByText("Est. wait: ~12 min")).toBeInTheDocument()
  })

  it("explains a missing estimate instead of guessing", async () => {
    mockWaitTime(null)
    render(<MemberStatusCard {...baseProps} status={{ phase: "waiting", position: 2, ahead: 1 }} />)
    expect(screen.getByText("1 person ahead of you")).toBeInTheDocument()
    expect(await screen.findByText(/once the organizer starts serving/)).toBeInTheDocument()
  })

  it("refetches the estimate as the line moves", async () => {
    mockWaitTime(2)
    const { rerender } = render(<MemberStatusCard {...baseProps} status={{ phase: "waiting", position: 5, ahead: 4 }} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    rerender(<MemberStatusCard {...baseProps} status={{ phase: "waiting", position: 4, ahead: 3 }} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByText("Est. wait: ~6 min")).toBeInTheDocument()
  })

  it("makes being called unmistakable", () => {
    render(
      <MemberStatusCard
        {...baseProps}
        status={{ phase: "called", position: 1, ahead: 0 }}
        calledAt={new Date().toISOString()}
      />
    )
    expect(screen.getByText("It's your turn")).toBeInTheDocument()
    expect(screen.getByText(/called you just now. It's your turn now./)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows next-up and served states", () => {
    const { rerender } = render(<MemberStatusCard {...baseProps} status={{ phase: "next", position: 1, ahead: 0 }} />)
    expect(screen.getByText("You're next")).toBeInTheDocument()
    rerender(<MemberStatusCard {...baseProps} status={{ phase: "served", position: 1, ahead: 0 }} />)
    expect(screen.getByText("You've been served")).toBeInTheDocument()
    expect(screen.queryByText(/listed for|isn't listed/)).not.toBeInTheDocument()
  })

  it("flags the waitlist when past capacity", () => {
    mockWaitTime(null)
    render(<MemberStatusCard {...baseProps} maxCapacity={3} status={{ phase: "waiting", position: 5, ahead: 4 }} />)
    expect(screen.getByText("You're on the waitlist")).toBeInTheDocument()
  })

  it("tells members the line is paused but their place is kept", () => {
    mockWaitTime(null)
    render(<MemberStatusCard {...baseProps} isPaused status={{ phase: "waiting", position: 3, ahead: 2 }} />)
    expect(screen.getByText(/You keep your place/)).toBeInTheDocument()
  })

  it("offers to turn on alerts and reflects the browser permission", () => {
    mockWaitTime(null)
    const onEnable = vi.fn()
    const status = { phase: "waiting" as const, position: 3, ahead: 2 }
    const { rerender } = render(
      <MemberStatusCard {...baseProps} status={status} notificationPermission="default" onEnableNotifications={onEnable} />
    )
    fireEvent.click(screen.getByRole("button", { name: "Turn on alerts" }))
    expect(onEnable).toHaveBeenCalled()

    rerender(<MemberStatusCard {...baseProps} status={status} notificationPermission="granted" />)
    expect(screen.getByText(/Alerts on/)).toBeInTheDocument()

    rerender(<MemberStatusCard {...baseProps} status={status} notificationPermission="denied" />)
    expect(screen.getByText(/blocked for this site/)).toBeInTheDocument()

    rerender(<MemberStatusCard {...baseProps} status={status} notificationPermission="unsupported" />)
    expect(screen.queryByRole("button", { name: "Turn on alerts" })).not.toBeInTheDocument()
  })
})
