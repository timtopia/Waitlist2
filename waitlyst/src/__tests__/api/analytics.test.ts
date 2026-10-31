import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  line: { findUnique: vi.fn() },
  queueVisit: { findMany: vi.fn() },
  linePosition: { findMany: vi.fn() },
  transaction: { findMany: vi.fn() },
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))

const ctx = { params: Promise.resolve({ lineId: "line-1" }) }

describe("GET /api/lines/[lineId]/analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1", kind: "RESTAURANT" })
  })

  it("is only for the owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "someone" } })
    const { GET } = await import("@/app/api/lines/[lineId]/analytics/route")
    expect((await GET(new Request("http://localhost"), ctx)).status).toBe(403)
  })

  it("returns finished and current visits, and what each swap earned", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    const joined = new Date("2026-10-30T18:00:00Z")
    mockPrisma.queueVisit.findMany.mockResolvedValue([
      { joinedAt: joined, servedAt: new Date("2026-10-30T18:20:00Z"), outcome: "SERVED", partySize: 4 },
    ])
    mockPrisma.linePosition.findMany.mockResolvedValue([
      { joinedAt: joined, fulfilledAt: null, fulfilled: false, partySize: 2 },
    ])
    mockPrisma.transaction.findMany.mockResolvedValue([
      { createdAt: joined, amount: 20, ownerFee: 2, platformFee: 1 },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/analytics/route")
    const data = await (await GET(new Request("http://localhost"), ctx)).json()

    expect(data.visits).toHaveLength(2)
    expect(data.visits[1]).toMatchObject({ outcome: "WAITING", partySize: 2 })
    expect(data.swaps[0]).toMatchObject({ ownerFee: 2, buyerPaid: 23 })
  })
})
