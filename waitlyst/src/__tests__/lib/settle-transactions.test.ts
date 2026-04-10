import { describe, it, expect, vi, beforeEach } from "vitest"
import { settleTransactionsForUser } from "@/lib/settle-transactions"

// Mock Prisma transaction client
const createMockTx = () => ({
  transaction: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  linePosition: {
    findUnique: vi.fn(),
  },
})

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

    // Both parties have left (no positions found)
    mockTx.linePosition.findUnique.mockResolvedValue(null)
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

    // Buyer still in line, seller not
    mockTx.linePosition.findUnique
      .mockResolvedValueOnce({ id: "pos", position: 1 }) // buyer found
      .mockResolvedValueOnce(null) // seller not found

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

    // Buyer not found, seller still in line
    mockTx.linePosition.findUnique
      .mockResolvedValueOnce(null) // buyer not found
      .mockResolvedValueOnce({ id: "pos", position: 2 }) // seller found

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
    mockTx.linePosition.findUnique
      .mockResolvedValueOnce(null) // txn-1 buyer (userId)
      .mockResolvedValueOnce(null) // txn-1 seller-1 gone
      .mockResolvedValueOnce(null) // txn-2 buyer (userId)
      .mockResolvedValueOnce({ id: "pos", position: 1 }) // txn-2 seller-2 still in line
      .mockResolvedValueOnce(null) // txn-3 buyer-3 gone
      .mockResolvedValueOnce(null) // txn-3 seller (userId)

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

  it("should process both COMPLETED and REFUNDED transactions", async () => {
    const lineId = "line-1"
    const userId = "user-leaving"

    // The findMany query filters by status: { in: ["COMPLETED", "REFUNDED"] }
    mockTx.transaction.findMany.mockResolvedValue([])

    const result = await settleTransactionsForUser(mockTx as any, lineId, userId)

    expect(result).toBe(0)
    expect(mockTx.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["COMPLETED", "REFUNDED"] },
        }),
      })
    )
  })
})
