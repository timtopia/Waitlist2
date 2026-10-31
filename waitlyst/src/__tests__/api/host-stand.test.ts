import { describe, it, expect, vi, beforeEach } from "vitest"

// Walk-ins, party notes, host-quoted waits and no-shows

const mockPrisma = {
  line: { findUnique: vi.fn() },
  linePosition: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue({ _sum: { partySize: 0 } }),
  },
  queueVisit: { count: vi.fn().mockResolvedValue(0) },
  user: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))

const restaurant = { id: "line-1", createdById: "owner-1", kind: "RESTAURANT", maxCapacity: 10 }
const ctx = { params: Promise.resolve({ lineId: "line-1" }) }
const post = (path: string, body: object, method = "POST") =>
  new Request(`http://localhost/api/lines/line-1/${path}`, { method, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma))
  mockPrisma.line.findUnique.mockResolvedValue(restaurant)
})

describe("POST /walk-in", () => {
  it("lets the host add someone without an account, as a party with a note", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.user.create.mockResolvedValue({ id: "walkin-1" })
    mockPrisma.linePosition.findFirst.mockResolvedValue({ position: 3 })
    mockPrisma.linePosition.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "pos-new", ...data }))

    const { POST } = await import("@/app/api/lines/[lineId]/walk-in/route")
    const res = await POST(post("walk-in", { name: "Rosa", partySize: 4, note: "high chair" }), ctx)

    expect(res.status).toBe(200)
    expect(mockPrisma.user.create).toHaveBeenCalledWith({ data: { name: "Rosa", isWalkIn: true } })
    expect(mockPrisma.linePosition.create).toHaveBeenCalledWith({
      data: { lineId: "line-1", userId: "walkin-1", position: 4, partySize: 4, note: "high chair" },
    })
  })

  it("respects the guest capacity", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.linePosition.aggregate.mockResolvedValueOnce({ _sum: { partySize: 8 } })

    const { POST } = await import("@/app/api/lines/[lineId]/walk-in/route")
    const res = await POST(post("walk-in", { name: "Rosa", partySize: 4 }), ctx)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/room for 2 more guests/)
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
  })

  it("is only for the line's owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "guest-1" } })

    const { POST } = await import("@/app/api/lines/[lineId]/walk-in/route")
    const res = await POST(post("walk-in", { name: "Rosa" }), ctx)

    expect(res.status).toBe(403)
  })
})

describe("POST /quote", () => {
  it("records the host's quote for a waiting party", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 1 })

    const { POST } = await import("@/app/api/lines/[lineId]/quote/route")
    const res = await POST(post("quote", { positionId: "pos-1", minutes: 25 }), ctx)

    expect(res.status).toBe(200)
    expect(mockPrisma.linePosition.updateMany).toHaveBeenCalledWith({
      where: { id: "pos-1", lineId: "line-1", fulfilled: false },
      data: { quotedMinutes: 25, quotedAt: expect.any(Date) },
    })
  })

  it("rejects a quote that isn't a sensible number of minutes", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })

    const { POST } = await import("@/app/api/lines/[lineId]/quote/route")
    const res = await POST(post("quote", { positionId: "pos-1", minutes: 2.5 }), ctx)

    expect(res.status).toBe(400)
    expect(mockPrisma.linePosition.updateMany).not.toHaveBeenCalled()
  })
})

describe("PATCH /party notes", () => {
  it("lets a called guest still change their note, but not their size", async () => {
    mockAuth.mockResolvedValue({ user: { id: "guest-1" } })
    const called = { id: "pos-1", userId: "guest-1", partySize: 2, fulfilled: false, calledAt: new Date() }
    mockPrisma.linePosition.findUnique.mockResolvedValue(called)
    mockPrisma.linePosition.update.mockImplementation(async ({ data }: { data: object }) => ({ ...called, ...data }))
    const { PATCH } = await import("@/app/api/lines/[lineId]/party/route")

    const noteRes = await PATCH(post("party", { note: "  patio please " }, "PATCH"), ctx)
    expect(noteRes.status).toBe(200)
    expect(mockPrisma.linePosition.update).toHaveBeenCalledWith({
      where: { id: "pos-1" },
      data: { partySize: 2, note: "patio please" },
    })

    const sizeRes = await PATCH(post("party", { partySize: 4 }, "PATCH"), ctx)
    expect(sizeRes.status).toBe(400)
  })

  it("refuses an overlong note", async () => {
    mockAuth.mockResolvedValue({ user: { id: "guest-1" } })
    mockPrisma.linePosition.findUnique.mockResolvedValue({ id: "pos-1", userId: "guest-1", partySize: 2, fulfilled: false, calledAt: null })
    const { PATCH } = await import("@/app/api/lines/[lineId]/party/route")

    const res = await PATCH(post("party", { note: "x".repeat(141) }, "PATCH"), ctx)

    expect(res.status).toBe(400)
    expect(mockPrisma.linePosition.update).not.toHaveBeenCalled()
  })
})
