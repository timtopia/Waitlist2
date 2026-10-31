import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Prisma
const mockPrisma = {
  line: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
    updateMany: vi.fn(),
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
    aggregate: vi.fn().mockResolvedValue({ _max: { updatedAt: null }, _count: 0 }),
    groupBy: vi.fn().mockResolvedValue([]),
  },
  transaction: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  swapOffer: {
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  queueVisit: {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
  },
  user: {
    findMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
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
  returnBuyerFunds: vi.fn().mockResolvedValue(0),
  releaseAndSettle: vi.fn().mockResolvedValue(true),
  expireCheckoutSession: vi.fn().mockResolvedValue(undefined),
  getBaseUrl: () => "http://localhost:3000",
}))

const mockSendEmail = vi.fn().mockResolvedValue(true)
vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
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
        { id: "line-1", name: "Public Line", isPublic: true, isActive: true, maxCapacity: null, hideCapacity: false, createdById: "creator-1", _count: { positions: 0 } },
      ])

      const { GET } = await import("@/app/api/lines/route")
      const req = new Request("http://localhost/api/lines")
      const response = await GET(req)

      expect(response.status).toBe(200)
      expect(mockPrisma.line.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, isPublic: true },
        })
      )
    })

    it("hides a hidden capacity but still says whether the line is full", async () => {
      mockPrisma.line.findMany.mockResolvedValue([
        { id: "line-1", maxCapacity: 3, hideCapacity: true, createdById: "creator-1", _count: { positions: 3 } },
        { id: "line-2", maxCapacity: 50, hideCapacity: false, createdById: "creator-1", _count: { positions: 3 } },
      ])
      mockPrisma.linePosition.groupBy.mockResolvedValue([
        { lineId: "line-1", fulfilled: false, _sum: { partySize: 3 }, _count: 3 },
        { lineId: "line-2", fulfilled: false, _sum: { partySize: 3 }, _count: 3 },
      ])

      const { GET } = await import("@/app/api/lines/route")
      const data = await (await GET(new Request("http://localhost/api/lines"))).json()

      expect(data[0]).toMatchObject({ maxCapacity: null, hasCapacityLimit: true, isFull: true })
      expect(data[1]).toMatchObject({ maxCapacity: 50, hasCapacityLimit: true, isFull: false })
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
      updatedAt: new Date(),
      createdBy: { id: "user-1", name: "Creator", image: null },
      positions: [],
    })

    const { GET } = await import("@/app/api/lines/[lineId]/route")
    const req = new Request("http://localhost/api/lines/line-1")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
  })

  it("hides a hidden capacity from everyone but the owner", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
      maxCapacity: 10,
      hideCapacity: true,
      updatedAt: new Date(),
      createdBy: { id: "owner-1", name: "Creator", image: null },
      positions: [{ id: "p1" }],
    })
    const { GET } = await import("@/app/api/lines/[lineId]/route")
    const get = async () =>
      (await GET(new Request("http://localhost/api/lines/line-1"), { params: Promise.resolve({ lineId: "line-1" }) })).json()

    mockAuth.mockResolvedValue({ user: { id: "member-1" } })
    expect(await get()).toMatchObject({ maxCapacity: null, hasCapacityLimit: true, isFull: false })

    mockAuth.mockResolvedValue(null)
    expect(await get()).toMatchObject({ maxCapacity: null })

    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    expect(await get()).toMatchObject({ maxCapacity: 10 })
  })

  it("shows names to the owner, short names to people in line, and none to anyone else", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
      maxCapacity: null,
      hideCapacity: false,
      updatedAt: new Date(),
      createdBy: { id: "owner-1", name: "Creator", image: null },
      positions: [
        { id: "p1", userId: "alice", lockedBy: null, partySize: 1, note: "high chair", quotedMinutes: 20, user: { id: "alice", name: "Alice Walker", image: "a.png" } },
        { id: "p2", userId: "member-1", lockedBy: null, partySize: 1, user: { id: "member-1", name: "Mia Chen", image: null } },
      ],
    })
    const { GET } = await import("@/app/api/lines/[lineId]/route")
    const first = async () => {
      const res = await GET(new Request("http://localhost/api/lines/line-1"), { params: Promise.resolve({ lineId: "line-1" }) })
      return (await res.json()).positions
    }

    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    const asOwner = await first()
    expect(asOwner[0].user.name).toBe("Alice Walker")
    expect(asOwner[0].note).toBe("high chair")

    mockAuth.mockResolvedValue({ user: { id: "member-1" } })
    mockPrisma.linePosition.findUnique.mockResolvedValueOnce({ id: "p2" })
    const asMember = await first()
    expect(asMember[0].user).toMatchObject({ id: "alice", name: "Alice W." })
    // Alice's note and quote are between her and the host
    expect(asMember[0]).toMatchObject({ note: null, quotedMinutes: null })
    expect(asMember[1].user.name).toBe("Mia Chen") // their own entry is untouched

    mockAuth.mockResolvedValue(null)
    const asPublic = await first()
    expect(asPublic[0].user).toEqual({ id: "anon-p1", name: null, image: null, isWalkIn: false })
    expect(asPublic[0].userId).toBe("anon-p1")
  })

  it("answers 304 without loading positions when the poller's ETag still matches", async () => {
    mockAuth.mockResolvedValue(null)
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
      maxCapacity: null,
      hideCapacity: false,
      updatedAt: new Date("2026-10-29T00:00:00Z"),
      createdBy: { id: "owner-1", name: "Creator", image: null },
      positions: [],
    })
    const { GET } = await import("@/app/api/lines/[lineId]/route")
    const ctx = { params: Promise.resolve({ lineId: "line-1" }) }

    const first = await GET(new Request("http://localhost/api/lines/line-1"), ctx)
    const etag = first.headers.get("ETag")!
    expect(etag).toBeTruthy()

    mockPrisma.line.findUnique.mockClear()
    const again = await GET(new Request("http://localhost/api/lines/line-1", { headers: { "If-None-Match": etag } }), ctx)
    expect(again.status).toBe(304)
    expect(mockPrisma.line.findUnique).toHaveBeenCalledTimes(1) // just the cheap check

    // Someone joins: the count changes, so the ETag no longer matches
    mockPrisma.linePosition.aggregate.mockResolvedValueOnce({ _max: { updatedAt: new Date() }, _count: 1 })
    const changed = await GET(new Request("http://localhost/api/lines/line-1", { headers: { "If-None-Match": etag } }), ctx)
    expect(changed.status).toBe(200)
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
    mockPrisma.linePosition.findMany.mockResolvedValue([])
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
    mockPrisma.linePosition.findMany.mockResolvedValue([])
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

  it("emails members who allow it, telling buyers their money was returned", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", name: "Drop", createdById: "owner-1" })
    mockPrisma.linePosition.findMany.mockResolvedValue([
      { user: { id: "buyer", name: "Bea", email: "bea@test", emailNotifications: true } },
      { user: { id: "plain", name: "Pat", email: "pat@test", emailNotifications: true } },
      { user: { id: "quiet", name: "Q", email: "q@test", emailNotifications: false } },
    ])
    mockPrisma.transaction.findMany
      .mockResolvedValueOnce([]) // pending
      .mockResolvedValueOnce([{ id: "txn-1", buyerId: "buyer", stripePaymentId: "cs_1" }])
    mockPrisma.transaction.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.line.delete.mockResolvedValue({ id: "line-1" })

    const { DELETE } = await import("@/app/api/lines/[lineId]/route")
    const response = await DELETE(new Request("http://localhost/api/lines/line-1", { method: "DELETE" }), { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    expect(mockSendEmail.mock.calls.map((c) => c[0])).toEqual(["bea@test", "pat@test"])
    expect(mockSendEmail.mock.calls[0][2]).toContain("returned to you")
    expect(mockSendEmail.mock.calls[1][2]).not.toContain("returned to you")
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
    // The route queries with isActive: true, so an inactive line isn't found
    mockPrisma.line.findUnique.mockResolvedValue(null)

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
    // The line row is locked before the next position is read
    const lockOrder = mockPrisma.$queryRaw.mock.invocationCallOrder[0]
    const readOrder = mockPrisma.linePosition.findFirst.mock.invocationCallOrder[0]
    expect(lockOrder).toBeLessThan(readOrder)
    expect(mockPrisma.$queryRaw.mock.calls[0][0].join("")).toContain("FOR UPDATE")
  })

  it("returns 500 without leaking the database error when the join fails unexpectedly", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-2" } })
    mockPrisma.$transaction.mockRejectedValueOnce(new Error("Unique constraint failed on the fields: (`lineId`,`position`)"))

    vi.resetModules()
    const { POST } = await import("@/app/api/lines/[lineId]/join/route")
    const req = new Request("http://localhost/api/lines/line-1/join", { method: "POST" })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).not.toContain("constraint")
  })

  describe("party sizes", () => {
    function joinAs(userId: string, body: unknown) {
      mockAuth.mockResolvedValue({ user: { id: userId } })
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma))
      mockPrisma.linePosition.findUnique.mockResolvedValue(null)
      mockPrisma.linePosition.findFirst.mockResolvedValue({ position: 3 })
      mockPrisma.linePosition.create.mockImplementation(async ({ data }: { data: unknown }) => data)
      return import("@/app/api/lines/[lineId]/join/route").then(({ POST }) =>
        POST(
          new Request("http://localhost/api/lines/line-1/join", { method: "POST", body: JSON.stringify(body) }),
          { params: Promise.resolve({ lineId: "line-1" }) }
        )
      )
    }

    it("a restaurant line records the party size the guest gave", async () => {
      mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner", isActive: true, kind: "RESTAURANT", maxCapacity: null })

      const response = await joinAs("guest-1", { partySize: 4 })

      expect(response.status).toBe(200)
      expect(mockPrisma.linePosition.create.mock.calls[0][0].data).toMatchObject({ position: 4, partySize: 4 })
    })

    it("capacity counts guests: a party of 4 doesn't fit when only 3 seats are left", async () => {
      mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner", isActive: true, kind: "RESTAURANT", maxCapacity: 20 })
      mockPrisma.linePosition.aggregate.mockResolvedValueOnce({ _sum: { partySize: 17 } })

      const response = await joinAs("guest-1", { partySize: 4 })

      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe("There's only room for 3 more guests in this line")
      expect(mockPrisma.linePosition.create).not.toHaveBeenCalled()
    })

    it("rejects a party bigger than the line seats from one spot", async () => {
      mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner", isActive: true, kind: "RESTAURANT", maxCapacity: null })

      const response = await joinAs("guest-1", { partySize: 21 })

      expect(response.status).toBe(400)
      expect(mockPrisma.linePosition.create).not.toHaveBeenCalled()
    })

    it("a standard line ignores any party size: everyone holds one spot", async () => {
      mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner", isActive: true, kind: "STANDARD", maxCapacity: null })

      const response = await joinAs("fan-1", { partySize: 6 })

      expect(response.status).toBe(200)
      expect(mockPrisma.linePosition.create.mock.calls[0][0].data).toMatchObject({ partySize: 1 })
    })
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
    mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.transaction.findUnique.mockResolvedValue({ stripePaymentId: "cs_1" })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.linePosition.delete.mockResolvedValue({ id: "pos-1" })
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 1 })

    const { DELETE } = await import("@/app/api/lines/[lineId]/leave/route")
    const { expireCheckoutSession } = await import("@/lib/stripe")
    const req = new Request("http://localhost/api/lines/line-1/leave", { method: "DELETE" })
    const response = await DELETE(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    // Only an unpaid checkout is failed -- never one that already completed
    expect(mockPrisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: "txn-pending", status: "PENDING" },
      data: { status: "FAILED" },
    })
    expect(expireCheckoutSession).toHaveBeenCalledWith("cs_1")
  })

  it("records the visit and collects purchases the leaver already made", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    const joinedAt = new Date("2026-01-01T10:00:00Z")
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-1", lineId: "line-1", userId: "user-1", position: 2, lockedBy: null,
      fulfilled: false, joinedAt, calledAt: null, fulfilledAt: null,
    })
    const purchase = { id: "txn-1", lineId: "line-1", sellerId: "seller-1", amount: 20, ownerFee: 2, stripePaymentId: "cs_9" }
    mockPrisma.transaction.findMany.mockResolvedValue([purchase])
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 1 })

    const { DELETE } = await import("@/app/api/lines/[lineId]/leave/route")
    const { releaseAndSettle } = await import("@/lib/stripe")
    const req = new Request("http://localhost/api/lines/line-1/leave", { method: "DELETE" })
    const response = await DELETE(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    expect((await response.json()).purchasesCollected).toBe(1)
    expect(mockPrisma.queueVisit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ lineId: "line-1", userId: "user-1", outcome: "LEFT", position: 2, joinedAt }),
    })
    // The seller gave up their place; leaving doesn't take their money back
    expect(releaseAndSettle).toHaveBeenCalledWith(purchase)
    expect(mockPrisma.swapOffer.updateMany).toHaveBeenCalledWith({
      where: { lineId: "line-1", status: "PENDING", OR: [{ fromUserId: "user-1" }, { toUserId: "user-1" }] },
      data: { status: "EXPIRED" },
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
    const joinedAt = new Date(Date.now() - 30 * 60000)
    mockPrisma.queueVisit.findMany.mockResolvedValue([
      { outcome: "SERVED", joinedAt, servedAt: new Date(joinedAt.getTime() + 12 * 60000) },
      { outcome: "LEFT", joinedAt, servedAt: null },
    ])
    mockPrisma.linePosition.findMany.mockResolvedValue([{ fulfilled: false, joinedAt, fulfilledAt: null }])

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
    expect(data.service).toEqual({
      served: 1, left: 1, removed: 0, noShows: 0, waiting: 1, medianWaitMinutes: 12, servedLastHour: 1,
    })
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
