import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  line: { findUnique: vi.fn() },
  linePosition: { findUnique: vi.fn(), findMany: vi.fn() },
  swapOffer: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), upsert: vi.fn() },
  transaction: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma)),
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))

const stripeMocks = {
  getStripe: vi.fn(() => null),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  performPositionSwap: vi.fn().mockResolvedValue(true),
  lockPositionsForTransaction: vi.fn().mockResolvedValue(true),
  abandonPendingTransaction: vi.fn().mockResolvedValue(true),
}
vi.mock("@/lib/stripe", () => stripeMocks)
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }))

const HOUR = 60 * 60 * 1000
const inHours = (h: number) => new Date(Date.now() + h * HOUR)
const ctx = (offerId = "offer-1") => ({ params: Promise.resolve({ lineId: "line-1", offerId }) })
let userSeq = 0
const freshUser = (prefix: string) => `${prefix}-${++userSeq}` // keeps per-user rate limiters apart

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.swapOffer.updateMany.mockResolvedValue({ count: 1 })
})

describe("GET /api/lines/[lineId]/offer", () => {
  it("retires expired and no-longer-adjacent pending offers, and flags accepted ones awaiting payment", async () => {
    const me = freshUser("ben")
    mockAuth.mockResolvedValue({ user: { id: me } })
    mockPrisma.swapOffer.findMany.mockResolvedValue([
      { id: "fresh", lineId: "line-1", fromUserId: me, toUserId: "sam", amount: 10, status: "PENDING", createdAt: new Date(), expiresAt: inHours(24) },
      { id: "old", lineId: "line-1", fromUserId: "cal", toUserId: me, amount: 5, status: "PENDING", createdAt: inHours(-25), expiresAt: inHours(-1) },
      { id: "moved", lineId: "line-1", fromUserId: "dee", toUserId: me, amount: 5, status: "PENDING", createdAt: new Date(), expiresAt: inHours(24) },
      { id: "accepted", lineId: "line-1", fromUserId: me, toUserId: "sam", amount: 10, status: "ACCEPTED", createdAt: new Date(), expiresAt: inHours(24), transactionId: "t-acc" },
      // An older accepted offer between the same pair whose swap already went through
      { id: "done", lineId: "line-1", fromUserId: "sam", toUserId: me, amount: 3, status: "ACCEPTED", createdAt: new Date(), expiresAt: inHours(24), transactionId: "t-done" },
    ])
    mockPrisma.linePosition.findMany.mockResolvedValue([
      { userId: "sam", position: 1 },
      { userId: me, position: 2 },
      { userId: "cal", position: 3 },
      { userId: "dee", position: 5 }, // someone left/swapped: dee is no longer right behind ben
    ])
    mockPrisma.transaction.findMany.mockResolvedValue([{ id: "t-acc" }])

    const { GET } = await import("@/app/api/lines/[lineId]/offer/route")
    const res = await GET(new Request("http://localhost/api/lines/line-1/offer"), { params: Promise.resolve({ lineId: "line-1" }) })
    const data = await res.json()

    expect(mockPrisma.swapOffer.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["old", "moved"] }, status: "PENDING" },
      data: { status: "EXPIRED" },
    })
    type Row = { id: string; status: string; expiresAt: string | null; awaitingPayment: boolean }
    const byId: Record<string, Row> = Object.fromEntries([...data.sent, ...data.received].map((o: Row) => [o.id, o]))
    expect(byId.fresh.status).toBe("PENDING")
    expect(byId.fresh.expiresAt).toBeTruthy()
    expect(byId.old.status).toBe("EXPIRED")
    expect(byId.moved.status).toBe("EXPIRED")
    expect(byId.accepted.awaitingPayment).toBe(true)
    // Matched by the offer's own checkout, not just "some pending payment between these two"
    expect(byId.done.awaitingPayment).toBe(false)
  })
})

describe("POST /api/lines/[lineId]/offer", () => {
  it("rejects offers under $1 (same floor as listings; Stripe can't charge cents)", async () => {
    mockAuth.mockResolvedValue({ user: { id: freshUser("ben") } })
    const { POST } = await import("@/app/api/lines/[lineId]/offer/route")
    const res = await POST(
      new Request("http://localhost/api/lines/line-1/offer", { method: "POST", body: JSON.stringify({ toUserId: "sam", amount: 0.25 }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    expect(res.status).toBe(400)
  })

  it("won't silently reset an accepted offer that is still waiting on payment", async () => {
    const me = freshUser("ben")
    mockAuth.mockResolvedValue({ user: { id: me } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", allowResale: true, maxAskingPrice: null, name: "L" })
    mockPrisma.linePosition.findUnique
      .mockResolvedValueOnce({ userId: me, position: 2 })
      .mockResolvedValueOnce({ userId: "sam", position: 1 })
    mockPrisma.swapOffer.findUnique.mockResolvedValue({ id: "o1", status: "ACCEPTED", createdAt: new Date(), expiresAt: inHours(24), transactionId: "t-pending" })
    mockPrisma.transaction.findFirst.mockResolvedValue({ id: "t-pending" })

    const { POST } = await import("@/app/api/lines/[lineId]/offer/route")
    const res = await POST(
      new Request("http://localhost/api/lines/line-1/offer", { method: "POST", body: JSON.stringify({ toUserId: "sam", amount: 5 }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    expect(res.status).toBe(409)
    expect(mockPrisma.swapOffer.upsert).not.toHaveBeenCalled()
  })

  it("won't make an offer to someone who has already been served", async () => {
    const me = freshUser("ben")
    mockAuth.mockResolvedValue({ user: { id: me } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", allowResale: true, maxAskingPrice: null, name: "L", nowServingUserId: null })
    mockPrisma.linePosition.findUnique
      .mockResolvedValueOnce({ userId: me, position: 2, fulfilled: false })
      .mockResolvedValueOnce({ userId: "sam", position: 1, fulfilled: true })

    const { POST } = await import("@/app/api/lines/[lineId]/offer/route")
    const res = await POST(
      new Request("http://localhost/api/lines/line-1/offer", { method: "POST", body: JSON.stringify({ toUserId: "sam", amount: 5 }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already been served/)
    expect(mockPrisma.swapOffer.upsert).not.toHaveBeenCalled()
  })

  it("won't make an offer to the person the organizer just called up", async () => {
    const me = freshUser("ben")
    mockAuth.mockResolvedValue({ user: { id: me } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", allowResale: true, maxAskingPrice: null, name: "L", nowServingUserId: "sam" })
    mockPrisma.linePosition.findUnique
      .mockResolvedValueOnce({ userId: me, position: 2, fulfilled: false })
      .mockResolvedValueOnce({ userId: "sam", position: 1, fulfilled: false })

    const { POST } = await import("@/app/api/lines/[lineId]/offer/route")
    const res = await POST(
      new Request("http://localhost/api/lines/line-1/offer", { method: "POST", body: JSON.stringify({ toUserId: "sam", amount: 5 }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/called up/)
  })

  it("stores an expiry on a new offer", async () => {
    const me = freshUser("ben")
    mockAuth.mockResolvedValue({ user: { id: me } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", allowResale: true, maxAskingPrice: null, name: "L", nowServingUserId: null })
    mockPrisma.linePosition.findUnique
      .mockResolvedValueOnce({ userId: me, position: 2, fulfilled: false })
      .mockResolvedValueOnce({ userId: "sam", position: 1, fulfilled: false })
    mockPrisma.swapOffer.findUnique.mockResolvedValue(null)
    mockPrisma.swapOffer.upsert.mockResolvedValue({ id: "o-new" })

    const { POST } = await import("@/app/api/lines/[lineId]/offer/route")
    const res = await POST(
      new Request("http://localhost/api/lines/line-1/offer", { method: "POST", body: JSON.stringify({ toUserId: "sam", amount: 5 }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    expect(res.status).toBe(201)
    const { create, update } = mockPrisma.swapOffer.upsert.mock.calls[0][0]
    const dayFromNow = Date.now() + 24 * HOUR
    expect(Math.abs(create.expiresAt.getTime() - dayFromNow)).toBeLessThan(5000)
    expect(update).toMatchObject({ status: "PENDING", transactionId: null })
  })

  it("makes them wait before re-sending right after a decline or withdrawal", async () => {
    const me = freshUser("ben")
    mockAuth.mockResolvedValue({ user: { id: me } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", allowResale: true, maxAskingPrice: null, name: "L", nowServingUserId: null })
    mockPrisma.linePosition.findUnique
      .mockResolvedValueOnce({ userId: me, position: 2, fulfilled: false })
      .mockResolvedValueOnce({ userId: "sam", position: 1, fulfilled: false })
    mockPrisma.swapOffer.findUnique.mockResolvedValue({ status: "WITHDRAWN", createdAt: new Date(Date.now() - 60_000) })
    mockPrisma.swapOffer.upsert.mockClear()

    const { POST } = await import("@/app/api/lines/[lineId]/offer/route")
    const res = await POST(
      new Request("http://localhost/api/lines/line-1/offer", { method: "POST", body: JSON.stringify({ toUserId: "sam", amount: 5 }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    expect(res.status).toBe(429)
    expect(mockPrisma.swapOffer.upsert).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/lines/[lineId]/offer/[offerId] accept", () => {
  function setupAccept(seller: string, expiresAt = inHours(24)) {
    mockAuth.mockResolvedValue({ user: { id: seller } })
    mockPrisma.swapOffer.findUnique.mockResolvedValue({
      id: "offer-1", lineId: "line-1", fromUserId: "ben", toUserId: seller, amount: 10, status: "PENDING", createdAt: new Date(), expiresAt,
    })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", isActive: true, allowResale: true, createdById: "owner", name: "L", ownerFeePercent: 0 })
    mockPrisma.linePosition.findUnique
      .mockResolvedValueOnce({ id: "p-ben", position: 2, lockedUntil: null })
      .mockResolvedValueOnce({ id: "p-sam", position: 1, lockedUntil: null, user: { name: "Sam" }, line: { name: "L" } })
    mockPrisma.transaction.create.mockResolvedValue({ id: "txn-1" })
  }
  const accept = async () => {
    const { PATCH } = await import("@/app/api/lines/[lineId]/offer/[offerId]/route")
    return PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ action: "accept" }) }), ctx())
  }

  it("refuses an offer older than 24h", async () => {
    setupAccept(freshUser("sam"), inHours(-1))
    const res = await accept()
    expect(res.status).toBe(410)
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled()
  })

  it("a double-click accept only starts one swap", async () => {
    setupAccept(freshUser("sam"))
    mockPrisma.swapOffer.updateMany.mockResolvedValueOnce({ count: 0 }) // the other click claimed it first
    const res = await accept()
    expect(res.status).toBe(409)
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled()
  })

  it("puts the offer back to PENDING if the dev-mode swap is refused (queue moved)", async () => {
    setupAccept(freshUser("sam"))
    stripeMocks.performPositionSwap.mockResolvedValueOnce(false)
    const res = await accept()
    expect(res.status).toBe(409)
    expect(mockPrisma.swapOffer.updateMany).toHaveBeenLastCalledWith({
      where: { id: "offer-1", status: "ACCEPTED" },
      data: { status: "PENDING", transactionId: null },
    })
  })

  it("records which checkout the accepted offer started", async () => {
    setupAccept(freshUser("sam"))
    mockPrisma.user.findUnique.mockResolvedValue(null)
    const res = await accept()
    expect(res.status).toBe(200)
    expect(mockPrisma.swapOffer.update).toHaveBeenCalledWith({ where: { id: "offer-1" }, data: { transactionId: "txn-1" } })
  })
})

describe("DELETE /api/lines/[lineId]/offer/[offerId] (withdraw)", () => {
  const withdraw = async () => {
    const { DELETE } = await import("@/app/api/lines/[lineId]/offer/[offerId]/route")
    return DELETE(new Request("http://localhost/x", { method: "DELETE" }), ctx())
  }

  it("withdraws a pending offer", async () => {
    const me = freshUser("ben")
    mockAuth.mockResolvedValue({ user: { id: me } })
    mockPrisma.swapOffer.findUnique.mockResolvedValue({ id: "offer-1", lineId: "line-1", fromUserId: me, toUserId: "sam", status: "PENDING" })
    const res = await withdraw()
    expect(res.status).toBe(200)
    // Kept as WITHDRAWN so the person in front can see it was taken back
    expect(mockPrisma.swapOffer.update).toHaveBeenCalledWith({
      where: { id: "offer-1" },
      data: { status: "WITHDRAWN", transactionId: null },
    })
    expect(mockPrisma.swapOffer.delete).not.toHaveBeenCalled()
  })

  it("backing out of an accepted-but-unpaid offer abandons the checkout and frees both spots", async () => {
    const me = freshUser("ben")
    mockAuth.mockResolvedValue({ user: { id: me } })
    mockPrisma.swapOffer.findUnique.mockResolvedValue({ id: "offer-1", lineId: "line-1", fromUserId: me, toUserId: "sam", status: "ACCEPTED", transactionId: "txn-pending" })
    mockPrisma.transaction.findFirst.mockResolvedValue({ id: "txn-pending" })
    const res = await withdraw()
    expect(res.status).toBe(200)
    expect(stripeMocks.abandonPendingTransaction).toHaveBeenCalledWith("txn-pending", { offerId: null })
  })

  it("can't withdraw a swap that already went through", async () => {
    const me = freshUser("ben")
    mockAuth.mockResolvedValue({ user: { id: me } })
    mockPrisma.swapOffer.findUnique.mockResolvedValue({ id: "offer-1", lineId: "line-1", fromUserId: me, toUserId: "sam", status: "ACCEPTED", transactionId: "txn-done" })
    mockPrisma.transaction.findFirst.mockResolvedValue(null)
    const res = await withdraw()
    expect(res.status).toBe(400)
    expect(mockPrisma.swapOffer.update).not.toHaveBeenCalled()
  })

  it("only the offerer can withdraw", async () => {
    mockAuth.mockResolvedValue({ user: { id: freshUser("sam") } })
    mockPrisma.swapOffer.findUnique.mockResolvedValue({ id: "offer-1", lineId: "line-1", fromUserId: "ben", toUserId: "sam", status: "PENDING" })
    const res = await withdraw()
    expect(res.status).toBe(403)
  })
})
