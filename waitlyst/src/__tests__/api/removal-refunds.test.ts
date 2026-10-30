import { describe, it, expect, vi, beforeEach } from "vitest"

// What happens to someone's open purchases when the organizer removes them,
// and whether the settlement page's Cancel only records refunds that happened.

const mockPrisma = {
  line: { findUnique: vi.fn() },
  linePosition: { findUnique: vi.fn(), findMany: vi.fn() },
  transaction: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  queueVisit: { findMany: vi.fn().mockResolvedValue([]) },
  $transaction: vi.fn(),
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))

const mockReturnBuyerFunds = vi.fn()
const mockReleaseAndSettle = vi.fn()
vi.mock("@/lib/stripe", () => ({
  returnBuyerFunds: (...args: unknown[]) => mockReturnBuyerFunds(...args),
  releaseAndSettle: (...args: unknown[]) => mockReleaseAndSettle(...args),
  expireCheckoutSession: vi.fn(),
  abandonPendingTransaction: vi.fn(),
}))

const heldPurchase = {
  id: "txn-1",
  lineId: "line-1",
  buyerId: "guest-1",
  sellerId: "seller-1",
  amount: 40,
  ownerFee: 4,
  platformFee: 2,
  stripePaymentId: "cs_1",
  status: "COMPLETED",
  settledAt: null,
}

describe("removeByOrganizer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.linePosition.findUnique.mockResolvedValue({ id: "pos-1", lineId: "line-1", userId: "guest-1", fulfilled: false })
    mockPrisma.transaction.findMany.mockResolvedValue([heldPurchase])
    mockPrisma.$transaction.mockResolvedValue({ abandonedSessionId: null })
  })

  it("keeping the purchase collects the held payment instead of refunding it", async () => {
    mockReleaseAndSettle.mockResolvedValue(true)
    const { removeByOrganizer } = await import("@/lib/queue-exit")

    const result = await removeByOrganizer("line-1", "pos-1", "payout")

    expect(mockReturnBuyerFunds).not.toHaveBeenCalled()
    expect(mockReleaseAndSettle).toHaveBeenCalledWith(heldPurchase)
    expect(result).toMatchObject({ refundedCount: 0, collectedCount: 1, collectFailedCount: 0 })
  })

  it("refunding reports what the buyer was charged, fees included", async () => {
    mockReturnBuyerFunds.mockResolvedValue(["txn-1"])
    const { removeByOrganizer } = await import("@/lib/queue-exit")

    const result = await removeByOrganizer("line-1", "pos-1", "refund")

    expect(mockReleaseAndSettle).not.toHaveBeenCalled()
    expect(result).toMatchObject({ refundedCount: 1, refundedAmount: 46, refundFailedCount: 0 })
  })

  it("reports a refund Stripe wouldn't do instead of claiming success", async () => {
    mockReturnBuyerFunds.mockResolvedValue([])
    const { removeByOrganizer } = await import("@/lib/queue-exit")

    const result = await removeByOrganizer("line-1", "pos-1", "refund")

    expect(result).toMatchObject({ refundedCount: 0, refundedAmount: 0, refundFailedCount: 1 })
  })
})

describe("POST /settlement/action cancel", () => {
  const post = async (body: object) => {
    const { POST } = await import("@/app/api/lines/[lineId]/settlement/action/route")
    return POST(
      new Request("http://localhost/api/lines/line-1/settlement/action", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })
    mockPrisma.transaction.findUnique.mockResolvedValue(heldPurchase)
  })

  it("closes out a purchase whose money went back", async () => {
    mockReturnBuyerFunds.mockResolvedValue(["txn-1"])

    const res = await post({ transactionId: "txn-1", action: "cancel" })

    expect(res.status).toBe(200)
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "txn-1" },
      data: { settledAt: expect.any(Date) },
    })
  })

  it("changes nothing when the money couldn't be returned", async () => {
    mockReturnBuyerFunds.mockResolvedValue([])

    const res = await post({ transactionId: "txn-1", action: "cancel" })

    expect(res.status).toBe(502)
    expect(mockPrisma.transaction.update).not.toHaveBeenCalled()
  })

  it("bulk cancel leaves alone a buyer who was served and then cleared from the line", async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([heldPurchase])
    mockPrisma.linePosition.findMany.mockResolvedValue([]) // cleared: no position
    mockPrisma.queueVisit.findMany.mockResolvedValueOnce([{ userId: "guest-1" }])
    mockReturnBuyerFunds.mockResolvedValue([])

    const res = await post({ action: "cancel-all-unfulfilled" })

    expect(await res.json()).toMatchObject({ count: 0, failedCount: 0 })
    expect(mockReturnBuyerFunds).toHaveBeenCalledWith([])
  })

  it("bulk cancel only closes out the purchases that were returned", async () => {
    const other = { ...heldPurchase, id: "txn-2", buyerId: "guest-2" }
    mockPrisma.transaction.findMany.mockResolvedValue([heldPurchase, other])
    mockPrisma.linePosition.findMany.mockResolvedValue([])
    mockReturnBuyerFunds.mockResolvedValue(["txn-1"])

    const res = await post({ action: "cancel-all-unfulfilled" })
    const data = await res.json()

    expect(data).toMatchObject({ count: 1, failedCount: 1 })
    expect(mockPrisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["txn-1"] } },
      data: { settledAt: expect.any(Date) },
    })
  })
})
