import { describe, it, expect, vi, beforeEach } from "vitest"
import { settleTransactionsForUser } from "@/lib/settle-transactions"

// Mock Prisma transaction client
const createMockTx = () => ({
  transaction: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  linePosition: {
    findMany: vi.fn(),
  },
})

/** Mock which users still hold a position in the line */
function stillInLine(mockTx: ReturnType<typeof createMockTx>, ...userIds: string[]) {
  mockTx.linePosition.findMany.mockResolvedValue(userIds.map((userId) => ({ userId })))
}

describe("settleTransactionsForUser", () => {
  let mockTx: ReturnType<typeof createMockTx>

  beforeEach(() => {
    mockTx = createMockTx()
    vi.clearAllMocks()
  })

  it("should settle transaction when both parties have left", async () => {
    const lineId = "line-1"
    const userId = "user-leaving"

    mockTx.transaction.findMany.mockResolvedValue([
      {
        id: "txn-1",
        buyerId: userId,
        sellerId: "other-user",
        status: "COMPLETED",
        settledAt: null,
      },
    ])

    stillInLine(mockTx)
    mockTx.transaction.updateMany.mockResolvedValue({ count: 1 })

    const result = await settleTransactionsForUser(mockTx as any, lineId, userId)

    expect(result).toBe(1)
    expect(mockTx.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["txn-1"] } },
      data: { settledAt: expect.any(Date) },
    })
  })

  it("should not settle when buyer is still in line", async () => {
    const lineId = "line-1"
    const userId = "seller-leaving"

    mockTx.transaction.findMany.mockResolvedValue([
      {
        id: "txn-1",
        buyerId: "buyer-user",
        sellerId: userId,
        status: "COMPLETED",
        settledAt: null,
      },
    ])

    stillInLine(mockTx, "buyer-user")

    const result = await settleTransactionsForUser(mockTx as any, lineId, userId)

    expect(result).toBe(0)
    expect(mockTx.transaction.updateMany).not.toHaveBeenCalled()
  })

  it("should not settle when seller is still in line", async () => {
    const lineId = "line-1"
    const userId = "buyer-leaving"

    mockTx.transaction.findMany.mockResolvedValue([
      {
        id: "txn-1",
        buyerId: userId,
        sellerId: "seller-user",
        status: "COMPLETED",
        settledAt: null,
      },
    ])

    stillInLine(mockTx, "seller-user")

    const result = await settleTransactionsForUser(mockTx as any, lineId, userId)

    expect(result).toBe(0)
    expect(mockTx.transaction.updateMany).not.toHaveBeenCalled()
  })

  it("should handle multiple transactions correctly", async () => {
    const lineId = "line-1"
    const userId = "user-leaving"

    mockTx.transaction.findMany.mockResolvedValue([
      { id: "txn-1", buyerId: userId, sellerId: "seller-1", status: "COMPLETED", settledAt: null },
      { id: "txn-2", buyerId: userId, sellerId: "seller-2", status: "COMPLETED", settledAt: null },
      { id: "txn-3", buyerId: "buyer-3", sellerId: userId, status: "COMPLETED", settledAt: null },
    ])

    // txn-1: buyer (userId) gone, seller-1 gone -> settle
    // txn-2: buyer (userId) gone, seller-2 still in line -> don't settle
    // txn-3: buyer-3 gone, seller (userId) gone -> settle
    stillInLine(mockTx, "seller-2")

    mockTx.transaction.updateMany.mockResolvedValue({ count: 2 })

    const result = await settleTransactionsForUser(mockTx as any, lineId, userId)

    expect(result).toBe(2)
    expect(mockTx.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["txn-1", "txn-3"] } },
      data: { settledAt: expect.any(Date) },
    })
  })

  it("should not settle already settled transactions", async () => {
    const lineId = "line-1"
    const userId = "user-leaving"

    // Query only returns unsettled transactions (settledAt: null in where clause)
    mockTx.transaction.findMany.mockResolvedValue([])

    const result = await settleTransactionsForUser(mockTx as any, lineId, userId)

    expect(result).toBe(0)
    expect(mockTx.transaction.updateMany).not.toHaveBeenCalled()
  })

  it("only closes out REFUNDED transactions, never uncaptured COMPLETED ones", async () => {
    // Regression: buyer bought a spot, then buyer and seller both left before
    // the buyer was served. The purchase was stamped settledAt -- which the
    // settlement page reads as "captured & paid out" -- so the owner could no
    // longer capture or release it, the hold lapsed, and the seller was never
    // paid while the owner's fee showed as earned.
    const lineId = "line-1"
    const userId = "user-leaving"

    mockTx.transaction.findMany.mockResolvedValue([])

    const result = await settleTransactionsForUser(mockTx as never, lineId, userId)

    expect(result).toBe(0)
    expect(mockTx.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "REFUNDED" }),
      })
    )
  })
})
