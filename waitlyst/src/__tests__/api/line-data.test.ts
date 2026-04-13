import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Prisma
const mockPrisma = {
  line: {
    findUnique: vi.fn(),
  },
  linePosition: {
    findMany: vi.fn(),
  },
  transaction: {
    findMany: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
}

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}))

// Mock auth
const mockAuth = vi.fn()
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}))

// ---------- Export API ----------

describe("GET /api/lines/[lineId]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { GET } = await import("@/app/api/lines/[lineId]/export/route")
    const req = new Request("http://localhost/api/lines/line-1/export")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(401)
  })

  it("should return 404 if line not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { GET } = await import("@/app/api/lines/[lineId]/export/route")
    const req = new Request("http://localhost/api/lines/line-1/export")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(404)
  })

  it("should return 403 if not line owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      name: "Test Line",
      createdById: "owner-1",
    })

    const { GET } = await import("@/app/api/lines/[lineId]/export/route")
    const req = new Request("http://localhost/api/lines/line-1/export")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(403)
  })

  it("should return CSV with headers only when no positions exist", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      name: "Test Line",
      createdById: "owner-1",
    })
    mockPrisma.linePosition.findMany.mockResolvedValue([])

    const { GET } = await import("@/app/api/lines/[lineId]/export/route")
    const req = new Request("http://localhost/api/lines/line-1/export")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/csv")

    const csv = await response.text()
    expect(csv).toBe("Position,Name,Email,Joined At,Asking Price,Status")
  })

  it("should return CSV with position data", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      name: "My Cool Line",
      createdById: "owner-1",
    })
    mockPrisma.linePosition.findMany.mockResolvedValue([
      {
        id: "pos-1",
        position: 1,
        joinedAt: new Date("2025-01-15T10:00:00Z"),
        askingPrice: null,
        lockedUntil: null,
        user: { name: "Alice", email: "alice@test.com" },
      },
      {
        id: "pos-2",
        position: 2,
        joinedAt: new Date("2025-01-15T11:00:00Z"),
        askingPrice: 25.0,
        lockedUntil: null,
        user: { name: "Bob", email: "bob@test.com" },
      },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/export/route")
    const req = new Request("http://localhost/api/lines/line-1/export")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/csv")
    expect(response.headers.get("Content-Disposition")).toContain("my-cool-line-export.csv")

    const csv = await response.text()
    const lines = csv.split("\n")
    expect(lines[0]).toBe("Position,Name,Email,Joined At,Asking Price,Status")
    expect(lines[1]).toContain("1,Alice,alice@test.com,")
    expect(lines[1]).toContain(",In Line")
    expect(lines[2]).toContain("2,Bob,bob@test.com,")
    expect(lines[2]).toContain("$25.00,For Sale")
  })

  it("should handle names with commas by quoting them", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      name: "Test Line",
      createdById: "owner-1",
    })
    mockPrisma.linePosition.findMany.mockResolvedValue([
      {
        id: "pos-1",
        position: 1,
        joinedAt: new Date("2025-01-15T10:00:00Z"),
        askingPrice: null,
        lockedUntil: null,
        user: { name: "Last, First", email: "user@test.com" },
      },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/export/route")
    const req = new Request("http://localhost/api/lines/line-1/export")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    const csv = await response.text()
    const dataRow = csv.split("\n")[1]
    expect(dataRow).toContain('"Last, First"')
  })
})

// ---------- Wait Time API ----------

describe("GET /api/lines/[lineId]/wait-time", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 404 if line not found", async () => {
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { GET } = await import("@/app/api/lines/[lineId]/wait-time/route")
    const req = new Request("http://localhost/api/lines/line-1/wait-time")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(404)
  })

  it("should return null estimate when not enough data", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdAt: new Date() })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.linePosition.findMany.mockResolvedValue([])

    const { GET } = await import("@/app/api/lines/[lineId]/wait-time/route")
    const req = new Request("http://localhost/api/lines/line-1/wait-time")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.estimatedMinutesPerPerson).toBeNull()
    expect(data.basedOn).toBe(0)
  })

  it("should estimate wait time from settled transactions", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdAt: new Date() })

    // Three settled events 10 minutes apart -> avg 10 min per person
    const base = new Date("2025-06-01T12:00:00Z")
    mockPrisma.transaction.findMany.mockResolvedValue([
      { settledAt: new Date(base.getTime()) },
      { settledAt: new Date(base.getTime() + 10 * 60000) },
      { settledAt: new Date(base.getTime() + 20 * 60000) },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/wait-time/route")
    const req = new Request("http://localhost/api/lines/line-1/wait-time")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.estimatedMinutesPerPerson).toBe(10)
    expect(data.basedOn).toBe(3)
  })

  it("should fall back to joinedAt gaps when no settled transactions", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdAt: new Date() })
    mockPrisma.transaction.findMany.mockResolvedValue([])

    const base = new Date("2025-06-01T12:00:00Z")
    mockPrisma.linePosition.findMany.mockResolvedValue([
      { joinedAt: new Date(base.getTime()) },
      { joinedAt: new Date(base.getTime() + 5 * 60000) },
      { joinedAt: new Date(base.getTime() + 10 * 60000) },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/wait-time/route")
    const req = new Request("http://localhost/api/lines/line-1/wait-time")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.estimatedMinutesPerPerson).toBe(5)
    expect(data.basedOn).toBe(3)
  })

  it("should deduplicate settled timestamps within 5 seconds", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdAt: new Date() })

    const base = new Date("2025-06-01T12:00:00Z")
    // Two transactions settled at the same moment, then one 6 minutes later, then another 6 minutes later
    mockPrisma.transaction.findMany.mockResolvedValue([
      { settledAt: new Date(base.getTime()) },
      { settledAt: new Date(base.getTime() + 2000) }, // within 5s, should be deduped
      { settledAt: new Date(base.getTime() + 6 * 60000) },
      { settledAt: new Date(base.getTime() + 12 * 60000) },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/wait-time/route")
    const req = new Request("http://localhost/api/lines/line-1/wait-time")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    // 3 unique events (0, 6min, 12min) -> avg interval 6 min
    expect(data.estimatedMinutesPerPerson).toBe(6)
    expect(data.basedOn).toBe(3)
  })
})

// ---------- Line Activity API (public) ----------

describe("GET /api/lines/[lineId]/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 404 if line not found", async () => {
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { GET } = await import("@/app/api/lines/[lineId]/activity/route")
    const req = new Request("http://localhost/api/lines/line-1/activity")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(404)
  })

  it("should return empty array when no activity", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1" })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.linePosition.findMany.mockResolvedValue([])
    mockPrisma.user.findMany.mockResolvedValue([])

    const { GET } = await import("@/app/api/lines/[lineId]/activity/route")
    const req = new Request("http://localhost/api/lines/line-1/activity")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual([])
  })

  it("should return mixed join and transaction activity sorted by date", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1" })

    mockPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "txn-1",
        buyerId: "user-1",
        sellerId: "user-2",
        amount: 15.0,
        status: "COMPLETED",
        createdAt: new Date("2025-06-01T14:00:00Z"),
      },
    ])

    mockPrisma.linePosition.findMany.mockResolvedValue([
      {
        id: "pos-1",
        joinedAt: new Date("2025-06-01T13:00:00Z"),
        user: { id: "user-1", name: "Alice" },
      },
    ])

    mockPrisma.user.findMany.mockResolvedValue([
      { id: "user-1", name: "Alice" },
      { id: "user-2", name: "Bob" },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/activity/route")
    const req = new Request("http://localhost/api/lines/line-1/activity")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    const data = await response.json()

    expect(data.length).toBe(2)
    // Most recent first: the sale at 14:00, then the join at 13:00
    expect(data[0].type).toBe("sale")
    expect(data[0].description).toContain("Alice")
    expect(data[0].description).toContain("Bob")
    expect(data[0].description).toContain("$15.00")
    expect(data[1].type).toBe("join")
    expect(data[1].description).toContain("Alice joined the line")
  })

  it("should include refund activities", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1" })

    mockPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "txn-1",
        buyerId: "user-1",
        sellerId: "user-2",
        amount: 20.0,
        status: "REFUNDED",
        createdAt: new Date("2025-06-01T14:00:00Z"),
      },
    ])

    mockPrisma.linePosition.findMany.mockResolvedValue([])
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "user-1", name: "Alice" },
      { id: "user-2", name: "Bob" },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/activity/route")
    const req = new Request("http://localhost/api/lines/line-1/activity")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.length).toBe(1)
    expect(data[0].type).toBe("refund")
    expect(data[0].description).toContain("$20.00")
  })
})

// ---------- Stats API ----------

describe("GET /api/lines/[lineId]/stats", () => {
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

  it("should return 404 if line not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { GET } = await import("@/app/api/lines/[lineId]/stats/route")
    const req = new Request("http://localhost/api/lines/line-1/stats")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(404)
  })

  it("should return 403 if not line owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })

    const { GET } = await import("@/app/api/lines/[lineId]/stats/route")
    const req = new Request("http://localhost/api/lines/line-1/stats")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(403)
  })

  it("should return zeroed stats when no transactions exist", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })
    mockPrisma.transaction.findMany.mockResolvedValue([])

    const { GET } = await import("@/app/api/lines/[lineId]/stats/route")
    const req = new Request("http://localhost/api/lines/line-1/stats")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.totalTransactions).toBe(0)
    expect(data.completedCount).toBe(0)
    expect(data.refundedCount).toBe(0)
    expect(data.pendingSettlementCount).toBe(0)
    expect(data.totalCompleted).toBe(0)
    expect(data.totalRefunded).toBe(0)
    expect(data.pendingSettlement).toBe(0)
    expect(data.netRevenue).toBe(0)
  })

  it("should compute stats correctly with mixed transaction statuses", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })
    mockPrisma.transaction.findMany.mockResolvedValue([
      { id: "t1", status: "COMPLETED", amount: 100, settledAt: new Date(), createdAt: new Date() },
      { id: "t2", status: "COMPLETED", amount: 50, settledAt: null, createdAt: new Date() },
      { id: "t3", status: "REFUNDED", amount: 30, settledAt: new Date(), createdAt: new Date() },
      { id: "t4", status: "PENDING", amount: 20, settledAt: null, createdAt: new Date() },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/stats/route")
    const req = new Request("http://localhost/api/lines/line-1/stats")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.totalTransactions).toBe(4)
    expect(data.completedCount).toBe(1) // settled completed only
    expect(data.refundedCount).toBe(1)
    expect(data.pendingSettlementCount).toBe(1) // unsettled completed
    expect(data.totalCompleted).toBe(100) // settled completed amount
    expect(data.totalRefunded).toBe(30)
    expect(data.pendingSettlement).toBe(50)
    expect(data.netRevenue).toBe(70) // 100 - 30
    expect(data.recentTransactions).toHaveLength(4)
  })
})

// ---------- User Activity API ----------

describe("GET /api/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { GET } = await import("@/app/api/activity/route")
    const response = await GET()

    expect(response.status).toBe(401)
  })

  it("should return empty array when user has no activity", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.linePosition.findMany.mockResolvedValue([])

    const { GET } = await import("@/app/api/activity/route")
    const response = await GET()

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual([])
  })

  it("should return join activity with line name", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.linePosition.findMany.mockResolvedValue([
      {
        id: "pos-1",
        userId: "user-1",
        joinedAt: new Date("2025-06-01T10:00:00Z"),
        line: { id: "line-1", name: "Concert Tickets" },
      },
    ])

    const { GET } = await import("@/app/api/activity/route")
    const response = await GET()

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.length).toBe(1)
    expect(data[0].type).toBe("joined")
    expect(data[0].description).toContain("Concert Tickets")
    expect(data[0].lineName).toBe("Concert Tickets")
  })

  it("should return purchase and sale activity for the user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })

    mockPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "txn-1",
        buyerId: "user-1",
        sellerId: "user-2",
        amount: 25.0,
        status: "COMPLETED",
        createdAt: new Date("2025-06-01T14:00:00Z"),
      },
      {
        id: "txn-2",
        buyerId: "user-3",
        sellerId: "user-1",
        amount: 10.0,
        status: "COMPLETED",
        createdAt: new Date("2025-06-01T15:00:00Z"),
      },
    ])
    mockPrisma.linePosition.findMany.mockResolvedValue([])

    const { GET } = await import("@/app/api/activity/route")
    const response = await GET()

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.length).toBe(2)

    // Most recent first: sale at 15:00, then purchase at 14:00
    const sale = data.find((a: { type: string }) => a.type === "sale")
    const purchase = data.find((a: { type: string }) => a.type === "purchase")
    expect(sale).toBeDefined()
    expect(sale.description).toContain("Sold a position for $10.00")
    expect(sale.amount).toBe(10)
    expect(purchase).toBeDefined()
    expect(purchase.description).toContain("Bought a position for $25.00")
    expect(purchase.amount).toBe(25)
  })

  it("should return refund activity", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })

    mockPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "txn-1",
        buyerId: "user-1",
        sellerId: "user-2",
        amount: 15.0,
        status: "REFUNDED",
        createdAt: new Date("2025-06-01T14:00:00Z"),
      },
    ])
    mockPrisma.linePosition.findMany.mockResolvedValue([])

    const { GET } = await import("@/app/api/activity/route")
    const response = await GET()

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.length).toBe(1)
    expect(data[0].type).toBe("refund")
    expect(data[0].description).toContain("Received refund of $15.00")
  })

  it("should combine and sort all activity types by date descending", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })

    mockPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "txn-1",
        buyerId: "user-1",
        sellerId: "user-2",
        amount: 25.0,
        status: "COMPLETED",
        createdAt: new Date("2025-06-01T12:00:00Z"),
      },
    ])
    mockPrisma.linePosition.findMany.mockResolvedValue([
      {
        id: "pos-1",
        userId: "user-1",
        joinedAt: new Date("2025-06-01T14:00:00Z"),
        line: { id: "line-1", name: "My Line" },
      },
    ])

    const { GET } = await import("@/app/api/activity/route")
    const response = await GET()

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.length).toBe(2)
    // Join at 14:00 should come before purchase at 12:00
    expect(data[0].type).toBe("joined")
    expect(data[1].type).toBe("purchase")
  })
})
