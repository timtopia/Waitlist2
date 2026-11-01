import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockPrisma = {
  linePosition: { findMany: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
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
  it("is the call time plus the window, extended once from the first 'on my way'", async () => {
    const { responseDeadline } = await import("@/lib/missed-calls")
    expect(responseDeadline(minutesAgo(10), 5, null)).toEqual(minutesAgo(5))
    // First said "on my way" 2 minutes ago: 5 more minutes from then, kept
    // even if they've since said they're running late
    expect(responseDeadline(minutesAgo(10), 5, minutesAgo(2))).toEqual(new Date(NOW.getTime() + 3 * 60_000))
  })

  it("adds the extra minutes the host gave them", async () => {
    const { responseDeadline } = await import("@/lib/missed-calls")
    expect(responseDeadline(minutesAgo(10), 5, null, 10)).toEqual(new Date(NOW.getTime() + 5 * 60_000))
  })
})

describe("expireMissedCalls", () => {
  beforeEach(() => vi.clearAllMocks())

  it("skips called people whose time ran out as no-shows, but not those on their way", async () => {
    mockPrisma.linePosition.findMany.mockResolvedValue([
      { id: "late", calledAt: minutesAgo(12), respondedAt: null },
      { id: "coming", calledAt: minutesAgo(12), respondedAt: minutesAgo(1) },
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
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  const respond = async (response: string) => {
    const { POST } = await import("@/app/api/lines/[lineId]/respond/route")
    return POST(
      new Request("http://localhost/api/lines/line-1/respond", { method: "POST", body: JSON.stringify({ response }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
  }
  const called = (over: Record<string, unknown> = {}) => ({
    id: "pos-1",
    calledAt: minutesAgo(3),
    respondedAt: null,
    line: { responseWindowMinutes: 10, isActive: true },
    ...over,
  })

  it("records the first 'on my way' as the time the extension runs from", async () => {
    mockAuth.mockResolvedValue({ user: { id: "guest-1" } })
    mockPrisma.linePosition.findFirst.mockResolvedValue(called())

    const res = await respond("ON_MY_WAY")

    expect(res.status).toBe(200)
    expect(mockPrisma.linePosition.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { lineId: "line-1", userId: "guest-1", fulfilled: false, calledAt: { not: null } },
    }))
    expect(mockPrisma.linePosition.update).toHaveBeenCalledWith({
      where: { id: "pos-1" },
      data: { response: "ON_MY_WAY", respondedAt: NOW },
    })
  })

  it("doesn't buy more time for saying 'on my way' again, or take it away for 'running late'", async () => {
    mockAuth.mockResolvedValue({ user: { id: "guest-1" } })
    mockPrisma.linePosition.findFirst.mockResolvedValue(called({ calledAt: minutesAgo(12), respondedAt: minutesAgo(4) }))

    expect((await respond("ON_MY_WAY")).status).toBe(200)
    expect(mockPrisma.linePosition.update).toHaveBeenLastCalledWith({ where: { id: "pos-1" }, data: { response: "ON_MY_WAY" } })

    // Past the original window, but still inside the "on my way" extension
    expect((await respond("RUNNING_LATE")).status).toBe(200)
    expect(mockPrisma.linePosition.update).toHaveBeenLastCalledWith({ where: { id: "pos-1" }, data: { response: "RUNNING_LATE" } })
  })

  it("refuses a reply once the time to show up has run out", async () => {
    mockAuth.mockResolvedValue({ user: { id: "guest-1" } })
    mockPrisma.linePosition.findFirst.mockResolvedValue(called({ calledAt: minutesAgo(11) }))

    expect((await respond("ON_MY_WAY")).status).toBe(409)
    expect(mockPrisma.linePosition.update).not.toHaveBeenCalled()
  })

  it("refuses someone who hasn't been called", async () => {
    mockAuth.mockResolvedValue({ user: { id: "guest-1" } })
    mockPrisma.linePosition.findFirst.mockResolvedValue(null)

    expect((await respond("RUNNING_LATE")).status).toBe(400)
  })
})
