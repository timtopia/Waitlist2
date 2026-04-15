import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Prisma
const mockPrisma = {
  line: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  linePosition: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  transaction: {
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn((fn) => fn(mockPrisma)),
}

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}))

// Mock auth
const mockAuth = vi.fn()
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}))


// Mock Stripe
const mockStripe = {
  refunds: { create: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
}
vi.mock("@/lib/stripe", () => ({
  stripe: mockStripe,
  refundTransactions: vi.fn().mockResolvedValue(0),
}))

// Mock settle-transactions
vi.mock("@/lib/settle-transactions", () => ({
  settleTransactionsForUser: vi.fn().mockResolvedValue(0),
}))

describe("Lines API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("POST /api/lines", () => {
    it("should return 401 if not authenticated", async () => {
      mockAuth.mockResolvedValue(null)

      const { POST } = await import("@/app/api/lines/route")
      const req = new Request("http://localhost/api/lines", {
        method: "POST",
        body: JSON.stringify({ name: "Test Line" }),
      })

      const response = await POST(req)
      expect(response.status).toBe(401)
    })

    it("should return 400 if name is missing", async () => {
      mockAuth.mockResolvedValue({ user: { id: "user-1" } })

      const { POST } = await import("@/app/api/lines/route")
      const req = new Request("http://localhost/api/lines", {
        method: "POST",
        body: JSON.stringify({ name: "" }),
      })

      const response = await POST(req)
      expect(response.status).toBe(400)
    })

    it("should create a line successfully", async () => {
      mockAuth.mockResolvedValue({ user: { id: "user-1" } })
      mockPrisma.line.create.mockResolvedValue({
        id: "line-1",
        name: "Test Line",
        description: null,
        createdById: "user-1",
        isPublic: true,
      })

      const { POST } = await import("@/app/api/lines/route")
      const req = new Request("http://localhost/api/lines", {
        method: "POST",
        body: JSON.stringify({ name: "Test Line", isPublic: true }),
      })

      const response = await POST(req)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.name).toBe("Test Line")
    })
  })

  describe("GET /api/lines", () => {
    it("should return only public active lines", async () => {
      mockPrisma.line.findMany.mockResolvedValue([
        { id: "line-1", name: "Public Line", isPublic: true, isActive: true, positions: [] },
      ])

      const { GET } = await import("@/app/api/lines/route")
      const response = await GET()

      expect(response.status).toBe(200)
      expect(mockPrisma.line.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, isPublic: true },
        })
      )
    })
  })
})

describe("GET /api/lines/[lineId]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return line details", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      name: "Test Line",
      createdBy: { id: "user-1", name: "Creator", image: null },
      positions: [],
    })

    const { GET } = await import("@/app/api/lines/[lineId]/route")
    const req = new Request("http://localhost/api/lines/line-1")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
  })

  it("should return 404 if line not found", async () => {
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { GET } = await import("@/app/api/lines/[lineId]/route")
    const req = new Request("http://localhost/api/lines/line-1")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(404)
  })
})

describe("DELETE /api/lines/[lineId]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/lines/[lineId]/route")
    const req = new Request("http://localhost/api/lines/line-1", { method: "DELETE" })
    const response = await DELETE(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(401)
  })

  it("should return 404 if line not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/lines/[lineId]/route")
    const req = new Request("http://localhost/api/lines/line-1", { method: "DELETE" })
    const response = await DELETE(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(404)
  })

  it("should return 403 if not line owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })

    const { DELETE } = await import("@/app/api/lines/[lineId]/route")
    const req = new Request("http://localhost/api/lines/line-1", { method: "DELETE" })
    const response = await DELETE(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(403)
  })

  it("should delete line and refund unsettled transactions", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })
    mockPrisma.transaction.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.transaction.findMany.mockResolvedValue([
      { id: "txn-1", stripePaymentId: "pi_123" },
    ])
    mockPrisma.line.delete.mockResolvedValue({ id: "line-1" })

    const { DELETE } = await import("@/app/api/lines/[lineId]/route")
    const req = new Request("http://localhost/api/lines/line-1", { method: "DELETE" })
    const response = await DELETE(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
  })

  it("should mark pending transactions as failed", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.line.delete.mockResolvedValue({ id: "line-1" })

    const { DELETE } = await import("@/app/api/lines/[lineId]/route")
    const req = new Request("http://localhost/api/lines/line-1", { method: "DELETE" })
    await DELETE(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(mockPrisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { lineId: "line-1", status: "PENDING" },
      data: { status: "FAILED" },
    })
  })
})

describe("Join Line API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/join/route")
    const req = new Request("http://localhost/api/lines/line-1/join", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(401)
  })

  it("should not allow creator to join their own line", async () => {
    mockAuth.mockResolvedValue({ user: { id: "creator-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "creator-1",
      isActive: true,
    })

    const { POST } = await import("@/app/api/lines/[lineId]/join/route")
    const req = new Request("http://localhost/api/lines/line-1/join", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("cannot join your own line")
  })

  it("should not allow joining an inactive line", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "creator-1",
      isActive: false,
    })

    const { POST } = await import("@/app/api/lines/[lineId]/join/route")
    const req = new Request("http://localhost/api/lines/line-1/join", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)
  })

  it("should successfully join a line", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
      return fn(mockPrisma)
    })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "creator-1",
      isActive: true,
    })
    mockPrisma.linePosition.findUnique.mockResolvedValue(null)
    mockPrisma.linePosition.findFirst.mockResolvedValue(null)
    mockPrisma.linePosition.create.mockResolvedValue({
      id: "pos-1",
      lineId: "line-1",
      userId: "user-1",
      position: 1,
      user: { id: "user-1", name: "Test User", image: null },
    })

    vi.resetModules()
    const { POST } = await import("@/app/api/lines/[lineId]/join/route")
    const req = new Request("http://localhost/api/lines/line-1/join", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)
  })
})

describe("Leave Line API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/lines/[lineId]/leave/route")
    const req = new Request("http://localhost/api/lines/line-1/leave", { method: "DELETE" })
    const response = await DELETE(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(401)
  })

  it("should return 400 if not in line", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.linePosition.findUnique.mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/lines/[lineId]/leave/route")
    const req = new Request("http://localhost/api/lines/line-1/leave", { method: "DELETE" })
    const response = await DELETE(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(400)
  })

  it("should successfully leave a line", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-1",
      lineId: "line-1",
      userId: "user-1",
      position: 2,
      lockedBy: null,
    })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.linePosition.delete.mockResolvedValue({ id: "pos-1" })
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 1 })

    const { DELETE } = await import("@/app/api/lines/[lineId]/leave/route")
    const req = new Request("http://localhost/api/lines/line-1/leave", { method: "DELETE" })
    const response = await DELETE(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
  })

  it("should cancel pending transaction when position is locked", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-1",
      lineId: "line-1",
      userId: "user-1",
      position: 2,
      lockedBy: "txn-pending",
    })
    mockPrisma.transaction.update.mockResolvedValue({ id: "txn-pending", status: "FAILED" })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.linePosition.delete.mockResolvedValue({ id: "pos-1" })
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 1 })

    const { DELETE } = await import("@/app/api/lines/[lineId]/leave/route")
    const req = new Request("http://localhost/api/lines/line-1/leave", { method: "DELETE" })
    const response = await DELETE(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "txn-pending" },
      data: { status: "FAILED" },
    })
  })

  it("should shift positions after leaving", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-1",
      lineId: "line-1",
      userId: "user-1",
      position: 2,
      lockedBy: null,
    })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.linePosition.delete.mockResolvedValue({ id: "pos-1" })
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 1 })

    const { DELETE } = await import("@/app/api/lines/[lineId]/leave/route")
    const req = new Request("http://localhost/api/lines/line-1/leave", { method: "DELETE" })
    await DELETE(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(mockPrisma.linePosition.updateMany).toHaveBeenCalledWith({
      where: { lineId: "line-1", position: { gt: 2 } },
      data: { position: { decrement: 1 } },
    })
  })
})

describe("Price API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should set asking price for a position", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", allowResale: true, maxAskingPrice: null })
    mockPrisma.linePosition.update.mockResolvedValue({
      id: "pos-1",
      askingPrice: 25.0,
      position: 1,
      user: { id: "user-1", name: "Test User", image: null },
    })

    const { PATCH } = await import("@/app/api/lines/[lineId]/price/route")
    const req = new Request("http://localhost/api/lines/line-1/price", {
      method: "PATCH",
      body: JSON.stringify({ price: 25.0 }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)
    expect(mockPrisma.linePosition.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { askingPrice: 25.0 },
      })
    )
  })

  it("should clear asking price when null is passed", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.linePosition.update.mockResolvedValue({
      id: "pos-1",
      askingPrice: null,
      position: 1,
      user: { id: "user-1", name: "Test User", image: null },
    })

    const { PATCH } = await import("@/app/api/lines/[lineId]/price/route")
    const req = new Request("http://localhost/api/lines/line-1/price", {
      method: "PATCH",
      body: JSON.stringify({ price: null }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)
  })
})

describe("Stats API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { GET } = await import("@/app/api/lines/[lineId]/stats/route")
    const req = new Request("http://localhost/api/lines/line-1/stats")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(401)
  })

  it("should return 403 if not line owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-user",
    })

    const { GET } = await import("@/app/api/lines/[lineId]/stats/route")
    const req = new Request("http://localhost/api/lines/line-1/stats")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(403)
  })

  it("should return transaction stats for line owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-user",
    })
    mockPrisma.transaction.findMany.mockResolvedValue([
      { id: "txn-1", status: "COMPLETED", amount: 100, settledAt: new Date() },
      { id: "txn-2", status: "COMPLETED", amount: 50, settledAt: null },
      { id: "txn-3", status: "REFUNDED", amount: 25, settledAt: new Date() },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/stats/route")
    const req = new Request("http://localhost/api/lines/line-1/stats")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.totalTransactions).toBe(3)
    expect(data.completedCount).toBe(1)
    expect(data.pendingSettlementCount).toBe(1)
    expect(data.totalCompleted).toBe(100)
    expect(data.pendingSettlement).toBe(50)
    expect(data.netRevenue).toBe(75)
  })
})

describe("Position Transactions API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { GET } = await import("@/app/api/lines/[lineId]/position-transactions/route")
    const req = new Request("http://localhost/api/lines/line-1/position-transactions?userId=user-1")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(401)
  })

  it("should return 400 if userId not provided", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-user" } })

    const { GET } = await import("@/app/api/lines/[lineId]/position-transactions/route")
    const req = new Request("http://localhost/api/lines/line-1/position-transactions")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)
  })

  it("should return 403 if not line owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-user",
    })

    const { GET } = await import("@/app/api/lines/[lineId]/position-transactions/route")
    const req = new Request("http://localhost/api/lines/line-1/position-transactions?userId=user-1")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(403)
  })

  it("should return transaction info for specified user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-user",
    })
    mockPrisma.transaction.findMany
      .mockResolvedValueOnce([
        { id: "txn-1", amount: 50, status: "COMPLETED", buyerId: "user-1" },
        { id: "txn-2", amount: 30, status: "COMPLETED", buyerId: "user-1" },
      ])
      .mockResolvedValueOnce([
        { id: "txn-3", amount: 20, status: "COMPLETED", buyerId: "buyer-1", sellerId: "user-1" },
      ])
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "buyer-1", name: "Buyer One" },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/position-transactions/route")
    const req = new Request("http://localhost/api/lines/line-1/position-transactions?userId=user-1")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.totalPaid).toBe(80)
    expect(data.totalReceived).toBe(20)
    expect(data.netAmount).toBe(-60)
    expect(data.asBuyer.length).toBe(2)
    expect(data.asSeller.length).toBe(1)
    expect(data.downstreamBuyers.length).toBe(1)
    expect(data.downstreamBuyers[0].name).toBe("Buyer One")
    expect(data.downstreamBuyers[0].amount).toBe(20)
  })
})

describe("Remove Position API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/remove-position/route")
    const req = new Request("http://localhost/api/lines/line-1/remove-position", {
      method: "POST",
      body: JSON.stringify({ positionId: "pos-1", action: "payout" }),
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(401)
  })

  it("should return 400 if positionId not provided", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-user" } })

    const { POST } = await import("@/app/api/lines/[lineId]/remove-position/route")
    const req = new Request("http://localhost/api/lines/line-1/remove-position", {
      method: "POST",
      body: JSON.stringify({ action: "payout" }),
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)
  })

  it("should return 400 for invalid action", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-user" } })

    const { POST } = await import("@/app/api/lines/[lineId]/remove-position/route")
    const req = new Request("http://localhost/api/lines/line-1/remove-position", {
      method: "POST",
      body: JSON.stringify({ positionId: "pos-1", action: "invalid" }),
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)
  })

  it("should return 403 if not line owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-user",
    })

    const { POST } = await import("@/app/api/lines/[lineId]/remove-position/route")
    const req = new Request("http://localhost/api/lines/line-1/remove-position", {
      method: "POST",
      body: JSON.stringify({ positionId: "pos-1", action: "payout" }),
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(403)
  })

  it("should remove position with payout action", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-user",
    })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-1",
      lineId: "line-1",
      userId: "user-1",
      position: 2,
      lockedBy: null,
      user: { id: "user-1", name: "Test" },
    })
    mockPrisma.linePosition.delete.mockResolvedValue({ id: "pos-1" })
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.transaction.updateMany.mockResolvedValue({ count: 0 })

    const { POST } = await import("@/app/api/lines/[lineId]/remove-position/route")
    const req = new Request("http://localhost/api/lines/line-1/remove-position", {
      method: "POST",
      body: JSON.stringify({ positionId: "pos-1", action: "payout" }),
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.action).toBe("payout")
  })
})
