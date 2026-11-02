import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  transaction: { findMany: vi.fn() },
  linePosition: { findMany: vi.fn() },
  queueVisit: { findMany: vi.fn() },
  swapOffer: { findMany: vi.fn() },
  line: { findMany: vi.fn() },
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))

const visit = (id: string, outcome: string, exitedAt: string, kind = "STANDARD") => ({
  id,
  outcome,
  joinedAt: new Date("2026-11-01T10:00:00Z"),
  servedAt: outcome === "SERVED" ? new Date(exitedAt) : null,
  exitedAt: new Date(exitedAt),
  line: { id: `line-${id}`, name: `Line ${id}`, kind },
})

describe("GET /api/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.linePosition.findMany.mockResolvedValue([])
    mockPrisma.queueVisit.findMany.mockResolvedValue([])
    mockPrisma.swapOffer.findMany.mockResolvedValue([])
    mockPrisma.line.findMany.mockResolvedValue([])
  })

  it("says how a finished visit ended, so a skipped or removed line doesn't just vanish", async () => {
    mockPrisma.queueVisit.findMany.mockResolvedValue([
      visit("a", "NO_SHOW", "2026-11-01T12:00:00Z"),
      visit("b", "SERVED", "2026-11-01T11:30:00Z", "RESTAURANT"),
      visit("c", "REMOVED", "2026-11-01T11:00:00Z"),
    ])
    const { GET } = await import("@/app/api/activity/route")
    const data = await (await GET()).json()

    const exits = data.filter((a: { id: string }) => a.id.startsWith("exit-"))
    expect(exits.map((a: { type: string; description: string }) => [a.type, a.description])).toEqual([
      ["removed", `Skipped in "Line a" after not showing up in time`],
      ["served", `Seated at "Line b"`],
      ["removed", `Removed from "Line c" by the organizer`],
    ])
    // The join is kept too, though the position itself is gone
    expect(data.some((a: { id: string }) => a.id === "join-visit-a")).toBe(true)
  })

  it("lists offers still waiting on an answer, with the line they're in", async () => {
    mockPrisma.swapOffer.findMany.mockResolvedValue([
      { id: "o1", lineId: "line-1", amount: 12.5, createdAt: new Date("2026-11-01T12:00:00Z") },
    ])
    mockPrisma.line.findMany.mockResolvedValue([{ id: "line-1", name: "Sneaker drop" }])
    const { GET } = await import("@/app/api/activity/route")
    const data = await (await GET()).json()

    expect(data).toEqual([
      expect.objectContaining({
        id: "offer-o1",
        type: "offer",
        description: `Received a $12.50 swap offer in "Sneaker drop"`,
        lineId: "line-1",
      }),
    ])
    expect(mockPrisma.swapOffer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { toUserId: "user-1", status: "PENDING", expiresAt: { gt: expect.any(Date) } },
      })
    )
  })
})
