import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  linePosition: { findMany: vi.fn(), updateMany: vi.fn() },
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
const removeByOrganizer = vi.fn()
vi.mock("@/lib/queue-exit", () => ({
  removeByOrganizer: (...args: unknown[]) => removeByOrganizer(...args),
  PositionNotFoundError: class extends Error {},
}))
const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))

const NOW = new Date("2026-11-01T20:00:00Z")
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

describe("responseDeadline", () => {
  it("is the call time plus the window, extended once by 'on my way'", async () => {
    const { responseDeadline } = await import("@/lib/missed-calls")
    expect(responseDeadline(minutesAgo(10), 5, null, null)).toEqual(minutesAgo(5))
    // Said "on my way" 2 minutes ago: 5 more minutes from then
    expect(responseDeadline(minutesAgo(10), 5, "ON_MY_WAY", minutesAgo(2))).toEqual(new Date(NOW.getTime() + 3 * 60_000))
    // "Running late" doesn't buy time
    expect(responseDeadline(minutesAgo(10), 5, "RUNNING_LATE", minutesAgo(2))).toEqual(minutesAgo(5))
  })
})

describe("expireMissedCalls", () => {
  beforeEach(() => vi.clearAllMocks())

  it("skips called people whose time ran out as no-shows, but not those on their way", async () => {
    mockPrisma.linePosition.findMany.mockResolvedValue([
      { id: "late", calledAt: minutesAgo(12), response: null, respondedAt: null },
      { id: "coming", calledAt: minutesAgo(12), response: "ON_MY_WAY", respondedAt: minutesAgo(1) },
    ])
    removeByOrganizer.mockResolvedValue({})
    const { expireMissedCalls } = await import("@/lib/missed-calls")

    expect(await expireMissedCalls("line-1", 10, NOW)).toBe(1)
    // A no-show that keeps purchases, emailed as a missed call
    expect(removeByOrganizer).toHaveBeenCalledWith("line-1", "late", "payout", true, true)
    expect(removeByOrganizer).toHaveBeenCalledTimes(1)
  })

  it("never skips walk-ins, and nobody while the line is paused", async () => {
    mockPrisma.linePosition.findMany.mockResolvedValue([])
    const { expireMissedCalls } = await import("@/lib/missed-calls")

    await expireMissedCalls("line-1", 10, NOW)

    expect(mockPrisma.linePosition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user: { isWalkIn: false }, line: { isActive: true } }),
      })
    )
  })
})

describe("POST /respond", () => {
  beforeEach(() => vi.clearAllMocks())

  it("records 'on my way' for someone who has been called", async () => {
    mockAuth.mockResolvedValue({ user: { id: "guest-1" } })
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 1 })
    const { POST } = await import("@/app/api/lines/[lineId]/respond/route")

    const res = await POST(
      new Request("http://localhost/api/lines/line-1/respond", { method: "POST", body: JSON.stringify({ response: "ON_MY_WAY" }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )

    expect(res.status).toBe(200)
    expect(mockPrisma.linePosition.updateMany).toHaveBeenCalledWith({
      where: { lineId: "line-1", userId: "guest-1", fulfilled: false, calledAt: { not: null } },
      data: { response: "ON_MY_WAY", respondedAt: expect.any(Date) },
    })
  })

  it("refuses someone who hasn't been called", async () => {
    mockAuth.mockResolvedValue({ user: { id: "guest-1" } })
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 0 })
    const { POST } = await import("@/app/api/lines/[lineId]/respond/route")

    const res = await POST(
      new Request("http://localhost/api/lines/line-1/respond", { method: "POST", body: JSON.stringify({ response: "RUNNING_LATE" }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )

    expect(res.status).toBe(400)
  })
})
