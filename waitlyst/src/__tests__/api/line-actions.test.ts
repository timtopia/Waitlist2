import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Prisma
const mockPrisma = {
  line: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  linePosition: {
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  },
  transaction: {
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  swapOffer: {
    updateMany: vi.fn(),
  },
  queueVisit: {
    create: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  },
  user: {
    update: vi.fn(),
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


// Mock settle-transactions
vi.mock("@/lib/settle-transactions", () => ({
  settleTransactionsForUser: vi.fn().mockResolvedValue(0),
}))

// Mock stripe
vi.mock("@/lib/stripe", () => ({
  refundTransactions: vi.fn().mockResolvedValue([]),
  returnBuyerFunds: vi.fn().mockResolvedValue([]),
  releaseAndSettle: vi.fn().mockResolvedValue(true),
  expireCheckoutSession: vi.fn().mockResolvedValue(undefined),
  abandonPendingTransaction: vi.fn().mockResolvedValue(true),
}))

// Mock fees
vi.mock("@/lib/fees", () => ({
  getPlatformFeePercent: vi.fn(() => 10),
  buyerTotal: (t: { amount: number; ownerFee: number; platformFee: number }) => t.amount + t.ownerFee + t.platformFee,
}))

// ─── Pause Route ────────────────────────────────────────────────────────────

describe("POST /api/lines/[lineId]/pause", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/pause/route")
    const req = new Request("http://localhost/api/lines/line-1/pause", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(401)
  })

  it("should return 404 if line not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/pause/route")
    const req = new Request("http://localhost/api/lines/line-1/pause", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(404)
  })

  it("should return 403 if not line owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
      isActive: true,
    })

    const { POST } = await import("@/app/api/lines/[lineId]/pause/route")
    const req = new Request("http://localhost/api/lines/line-1/pause", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(403)
  })

  it("should toggle isActive from true to false", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
      isActive: true,
    })
    mockPrisma.line.update.mockResolvedValue({
      id: "line-1",
      isActive: false,
    })

    const { POST } = await import("@/app/api/lines/[lineId]/pause/route")
    const req = new Request("http://localhost/api/lines/line-1/pause", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.isActive).toBe(false)
    expect(mockPrisma.line.update).toHaveBeenCalledWith({
      where: { id: "line-1" },
      data: { isActive: false, pausedAt: expect.any(Date) },
    })
  })

  it("should toggle isActive from false to true", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
      isActive: false,
    })
    mockPrisma.line.update.mockResolvedValue({
      id: "line-1",
      isActive: true,
    })

    const { POST } = await import("@/app/api/lines/[lineId]/pause/route")
    const req = new Request("http://localhost/api/lines/line-1/pause", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.isActive).toBe(true)
    expect(mockPrisma.line.update).toHaveBeenCalledWith({
      where: { id: "line-1" },
      data: { isActive: true, pausedAt: null },
    })
  })

  it("gives called people back the time the line spent paused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const now = new Date("2026-11-01T20:30:00Z")
    vi.setSystemTime(now)
    const at = (hhmm: string) => new Date(`2026-11-01T${hhmm}:00Z`)
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
      isActive: false,
      pausedAt: at("20:00"),
    })
    mockPrisma.linePosition.findMany.mockResolvedValue([
      // Called before the pause, said "on my way" before it too
      { id: "before", calledAt: at("19:55"), respondedAt: at("19:58") },
      // Called while the line was paused: the clock starts on resume
      { id: "during", calledAt: at("20:10"), respondedAt: null },
    ])

    const { POST } = await import("@/app/api/lines/[lineId]/pause/route")
    const response = await POST(
      new Request("http://localhost/api/lines/line-1/pause", { method: "POST", body: JSON.stringify({ isActive: true }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    vi.useRealTimers()

    expect(response.status).toBe(200)
    expect(mockPrisma.linePosition.update).toHaveBeenCalledWith({
      where: { id: "before" },
      data: { calledAt: at("20:25"), respondedAt: at("20:28") },
    })
    expect(mockPrisma.linePosition.update).toHaveBeenCalledWith({
      where: { id: "during" },
      data: { calledAt: now, respondedAt: null },
    })
  })
})

// ─── Duplicate Route ────────────────────────────────────────────────────────

describe("POST /api/lines/[lineId]/duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/duplicate/route")
    const req = new Request("http://localhost/api/lines/line-1/duplicate", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(401)
  })

  it("should return 404 if line not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/duplicate/route")
    const req = new Request("http://localhost/api/lines/line-1/duplicate", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(404)
  })

  it("should return 403 if not line owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      name: "My Line",
      createdById: "owner-1",
    })

    const { POST } = await import("@/app/api/lines/[lineId]/duplicate/route")
    const req = new Request("http://localhost/api/lines/line-1/duplicate", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(403)
  })

  it("should create a copy of the line with (Copy) suffix", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      name: "My Line",
      description: "A test line",
      createdById: "owner-1",
      isPublic: true,
      maxCapacity: 50,
      ownerFeePercent: 5,
      kind: "RESTAURANT",
      allowResale: false,
      maxAskingPrice: null,
      hideCapacity: true,
      productName: null,
      productImage: null,
      productPrice: null,
      productUrl: null,
    })
    mockPrisma.line.create.mockResolvedValue({
      id: "line-2",
      name: "My Line (Copy)",
      description: "A test line",
      createdById: "owner-1",
      isPublic: true,
      isActive: true,
      maxCapacity: 50,
      ownerFeePercent: 5,
    })

    const { POST } = await import("@/app/api/lines/[lineId]/duplicate/route")
    const req = new Request("http://localhost/api/lines/line-1/duplicate", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.name).toBe("My Line (Copy)")
    expect(data.id).toBe("line-2")
    // Every setting carries over (swaps stay off, still a restaurant line),
    // and the copy starts paused
    expect(mockPrisma.line.create).toHaveBeenCalledWith({
      data: {
        name: "My Line (Copy)",
        description: "A test line",
        createdById: "owner-1",
        isPublic: true,
        isActive: false,
        kind: "RESTAURANT",
        maxCapacity: 50,
        hideCapacity: true,
        ownerFeePercent: 5,
        allowResale: false,
        maxAskingPrice: null,
        productName: null,
        productImage: null,
        productPrice: null,
        productUrl: null,
      },
    })
  })
})

// ─── Announcement Route ─────────────────────────────────────────────────────

describe("PATCH /api/lines/[lineId]/announcement", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { PATCH } = await import("@/app/api/lines/[lineId]/announcement/route")
    const req = new Request("http://localhost/api/lines/line-1/announcement", {
      method: "PATCH",
      body: JSON.stringify({ announcement: "Hello" }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(401)
  })

  it("should return 404 if line not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { PATCH } = await import("@/app/api/lines/[lineId]/announcement/route")
    const req = new Request("http://localhost/api/lines/line-1/announcement", {
      method: "PATCH",
      body: JSON.stringify({ announcement: "Hello" }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(404)
  })

  it("should return 403 if not line owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })

    const { PATCH } = await import("@/app/api/lines/[lineId]/announcement/route")
    const req = new Request("http://localhost/api/lines/line-1/announcement", {
      method: "PATCH",
      body: JSON.stringify({ announcement: "Hello" }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(403)
  })

  it("should return 400 if announcement is not a string", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })

    const { PATCH } = await import("@/app/api/lines/[lineId]/announcement/route")
    const req = new Request("http://localhost/api/lines/line-1/announcement", {
      method: "PATCH",
      body: JSON.stringify({ announcement: 12345 }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("string")
  })

  it("should return 400 if announcement exceeds 280 characters", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })

    const { PATCH } = await import("@/app/api/lines/[lineId]/announcement/route")
    const req = new Request("http://localhost/api/lines/line-1/announcement", {
      method: "PATCH",
      body: JSON.stringify({ announcement: "x".repeat(281) }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("280")
  })

  it("should set announcement successfully", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })
    mockPrisma.line.update.mockResolvedValue({
      id: "line-1",
      announcement: "Important update",
      announcementAt: new Date(),
      platformFeePercent: 10,
    })

    const { PATCH } = await import("@/app/api/lines/[lineId]/announcement/route")
    const req = new Request("http://localhost/api/lines/line-1/announcement", {
      method: "PATCH",
      body: JSON.stringify({ announcement: "Important update" }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    expect(mockPrisma.line.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "line-1" },
        data: expect.objectContaining({
          announcement: "Important update",
        }),
      })
    )
  })

  it("should clear announcement when empty string is sent", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })
    mockPrisma.line.update.mockResolvedValue({
      id: "line-1",
      announcement: null,
      announcementAt: null,
    })

    const { PATCH } = await import("@/app/api/lines/[lineId]/announcement/route")
    const req = new Request("http://localhost/api/lines/line-1/announcement", {
      method: "PATCH",
      body: JSON.stringify({ announcement: "" }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    expect(mockPrisma.line.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          announcement: null,
          announcementAt: null,
        }),
      })
    )
  })
})

// ─── Settings Route ─────────────────────────────────────────────────────────

describe("PATCH /api/lines/[lineId]/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects a closing time that isn't a date instead of failing with a 500", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1", opensAt: null, closesAt: null })

    const { PATCH } = await import("@/app/api/lines/[lineId]/settings/route")
    const response = await PATCH(
      new Request("http://localhost/api/lines/line-1/settings", { method: "PATCH", body: JSON.stringify({ closesAt: "not a date" }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    expect(response.status).toBe(400)
    expect(mockPrisma.line.update).not.toHaveBeenCalled()
  })

  it("rejects a closing time before the stored opening time", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
      opensAt: new Date("2030-01-02T18:00:00Z"),
      closesAt: null,
    })

    const { PATCH } = await import("@/app/api/lines/[lineId]/settings/route")
    const response = await PATCH(
      new Request("http://localhost/api/lines/line-1/settings", {
        method: "PATCH",
        body: JSON.stringify({ closesAt: "2030-01-02T17:00:00Z" }),
      }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/close after it opens/)
  })

  it("rejects a time-to-show-up outside 1 to 60 minutes", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })

    const { PATCH } = await import("@/app/api/lines/[lineId]/settings/route")
    const response = await PATCH(
      new Request("http://localhost/api/lines/line-1/settings", { method: "PATCH", body: JSON.stringify({ responseWindowMinutes: 0 }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    expect(response.status).toBe(400)
    expect(mockPrisma.line.update).not.toHaveBeenCalled()
  })

  it("rejects a product image that isn't an https link", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })

    const { PATCH } = await import("@/app/api/lines/[lineId]/settings/route")
    const response = await PATCH(
      new Request("http://localhost/api/lines/line-1/settings", {
        method: "PATCH",
        body: JSON.stringify({ productImage: "http://example.com/shoe.jpg" }),
      }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    expect(response.status).toBe(400)
  })

  it("calls off checkouts already underway when swaps are turned off", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })
    mockPrisma.line.update.mockResolvedValue({ id: "line-1", allowResale: false })
    mockPrisma.transaction.findMany.mockResolvedValue([{ id: "txn-live" }])
    mockPrisma.$transaction.mockImplementation(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof mockPrisma) => unknown)(mockPrisma)
    )
    const { abandonPendingTransaction } = await import("@/lib/stripe")

    const { PATCH } = await import("@/app/api/lines/[lineId]/settings/route")
    const response = await PATCH(
      new Request("http://localhost/api/lines/line-1/settings", { method: "PATCH", body: JSON.stringify({ allowResale: false }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma))

    expect(response.status).toBe(200)
    expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith({
      where: { lineId: "line-1", status: "PENDING" },
      select: { id: true },
    })
    expect(abandonPendingTransaction).toHaveBeenCalledWith("txn-live", { offerId: null })
    expect(mockPrisma.swapOffer.updateMany).toHaveBeenCalledWith({
      where: { transactionId: "txn-live", status: "ACCEPTED" },
      data: { status: "EXPIRED" },
    })
  })

  it("won't take a max asking price under $1, which would block every listing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })

    const { PATCH } = await import("@/app/api/lines/[lineId]/settings/route")
    const response = await PATCH(
      new Request("http://localhost/api/lines/line-1/settings", { method: "PATCH", body: JSON.stringify({ maxAskingPrice: 0.5 }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    expect(response.status).toBe(400)
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { PATCH } = await import("@/app/api/lines/[lineId]/settings/route")
    const req = new Request("http://localhost/api/lines/line-1/settings", {
      method: "PATCH",
      body: JSON.stringify({ name: "New Name" }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(401)
  })

  it("should return 404 if line not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { PATCH } = await import("@/app/api/lines/[lineId]/settings/route")
    const req = new Request("http://localhost/api/lines/line-1/settings", {
      method: "PATCH",
      body: JSON.stringify({ name: "New Name" }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(404)
  })

  it("should return 403 if not line owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })

    const { PATCH } = await import("@/app/api/lines/[lineId]/settings/route")
    const req = new Request("http://localhost/api/lines/line-1/settings", {
      method: "PATCH",
      body: JSON.stringify({ name: "New Name" }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(403)
  })

  it("should update allowed fields successfully", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })
    mockPrisma.line.update.mockResolvedValue({
      id: "line-1",
      name: "Updated Name",
      isPublic: false,
      description: "New description",
    })

    const { PATCH } = await import("@/app/api/lines/[lineId]/settings/route")
    const req = new Request("http://localhost/api/lines/line-1/settings", {
      method: "PATCH",
      body: JSON.stringify({
        name: "Updated Name",
        isPublic: false,
        description: "New description",
      }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    expect(mockPrisma.line.update).toHaveBeenCalledWith({
      where: { id: "line-1" },
      data: {
        name: "Updated Name",
        isPublic: false,
        description: "New description",
      },
    })
  })

  it("should return 400 if maxCapacity is less than current participants", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
      kind: "STANDARD",
    })
    mockPrisma.linePosition.count.mockResolvedValue(10)

    const { PATCH } = await import("@/app/api/lines/[lineId]/settings/route")
    const req = new Request("http://localhost/api/lines/line-1/settings", {
      method: "PATCH",
      body: JSON.stringify({ maxCapacity: 5 }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("Capacity")
  })

  it("should clamp ownerFeePercent to 0-50 range", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })
    mockPrisma.line.update.mockResolvedValue({
      id: "line-1",
      ownerFeePercent: 50,
    })

    const { PATCH } = await import("@/app/api/lines/[lineId]/settings/route")
    const req = new Request("http://localhost/api/lines/line-1/settings", {
      method: "PATCH",
      body: JSON.stringify({ ownerFeePercent: 99 }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    expect(mockPrisma.line.update).toHaveBeenCalledWith({
      where: { id: "line-1" },
      data: { ownerFeePercent: 50 },
    })
  })
})

// ─── Remove Front Route ─────────────────────────────────────────────────────

describe("POST /api/lines/[lineId]/remove-front", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
      return fn(mockPrisma)
    })
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/remove-front/route")
    const req = new Request("http://localhost/api/lines/line-1/remove-front", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(401)
  })

  it("should return 403 if not line owner", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })

    const { POST } = await import("@/app/api/lines/[lineId]/remove-front/route")
    const req = new Request("http://localhost/api/lines/line-1/remove-front", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(403)
    const data = await response.json()
    expect(data.error).toContain("Not authorized")
  })

  it("should return 404 if line not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/remove-front/route")
    const req = new Request("http://localhost/api/lines/line-1/remove-front", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toContain("not found")
  })

  it("refuses to remove someone else when the person the dashboard showed has gone", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })
    mockPrisma.linePosition.findUnique.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/remove-front/route")
    const response = await POST(
      new Request("http://localhost/api/lines/line-1/remove-front", {
        method: "POST",
        body: JSON.stringify({ positionId: "pos-gone" }),
      }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )

    expect(response.status).toBe(409)
    expect(mockPrisma.linePosition.delete).not.toHaveBeenCalled()
  })

  it("should return 400 if no one is in line", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })
    mockPrisma.linePosition.findFirst.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/remove-front/route")
    const req = new Request("http://localhost/api/lines/line-1/remove-front", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("No one")
  })

  it("should remove the front person and shift positions", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })
    mockPrisma.linePosition.findFirst.mockResolvedValue({
      id: "pos-1",
      lineId: "line-1",
      userId: "user-1",
      position: 1,
      lockedBy: null,
      fulfilled: false,
      user: { name: "Alice" },
    })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.linePosition.delete.mockResolvedValue({ id: "pos-1" })
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 2 })

    const { POST } = await import("@/app/api/lines/[lineId]/remove-front/route")
    const req = new Request("http://localhost/api/lines/line-1/remove-front", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.success).toBe(true)

    expect(mockPrisma.linePosition.delete).toHaveBeenCalledWith({
      where: { id: "pos-1" },
    })
    expect(mockPrisma.linePosition.updateMany).toHaveBeenCalledWith({
      where: { lineId: "line-1", position: { gt: 1 } },
      data: { position: { decrement: 1 } },
    })
  })

  it("should cancel locked transaction when removing front person", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      createdById: "owner-1",
    })
    mockPrisma.linePosition.findFirst.mockResolvedValue({
      id: "pos-1",
      lineId: "line-1",
      userId: "user-1",
      position: 1,
      lockedBy: "txn-pending",
      fulfilled: false,
      user: { name: "Bob" },
    })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.transaction.findUnique.mockResolvedValue({ stripePaymentId: "cs_live" })
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.linePosition.delete.mockResolvedValue({ id: "pos-1" })

    const { POST } = await import("@/app/api/lines/[lineId]/remove-front/route")
    const { expireCheckoutSession } = await import("@/lib/stripe")
    const req = new Request("http://localhost/api/lines/line-1/remove-front", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    expect(mockPrisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: "txn-pending", status: "PENDING" },
      data: { status: "FAILED" },
    })
    // The buyer's payment page is killed too, so they can't pay for a spot
    // whose holder was just removed.
    expect(expireCheckoutSession).toHaveBeenCalledWith("cs_live")
    expect(mockPrisma.queueVisit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", outcome: "REMOVED", position: 1 }),
    })
  })
})

// ─── User Route ─────────────────────────────────────────────────────────────

describe("PATCH /api/user", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { PATCH } = await import("@/app/api/user/route")
    const req = new Request("http://localhost/api/user", {
      method: "PATCH",
      body: JSON.stringify({ name: "New Name" }),
    })

    const response = await PATCH(req)
    expect(response.status).toBe(401)
  })

  it("should return 400 if name is empty", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })

    const { PATCH } = await import("@/app/api/user/route")
    const req = new Request("http://localhost/api/user", {
      method: "PATCH",
      body: JSON.stringify({ name: "" }),
    })

    const response = await PATCH(req)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("1 and 50")
  })

  it("should return 400 if name is only whitespace", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })

    const { PATCH } = await import("@/app/api/user/route")
    const req = new Request("http://localhost/api/user", {
      method: "PATCH",
      body: JSON.stringify({ name: "   " }),
    })

    const response = await PATCH(req)
    expect(response.status).toBe(400)
  })

  it("should return 400 if name exceeds 50 characters", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })

    const { PATCH } = await import("@/app/api/user/route")
    const req = new Request("http://localhost/api/user", {
      method: "PATCH",
      body: JSON.stringify({ name: "a".repeat(51) }),
    })

    const response = await PATCH(req)
    expect(response.status).toBe(400)
  })

  it("should return 400 if name is not a string", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })

    const { PATCH } = await import("@/app/api/user/route")
    const req = new Request("http://localhost/api/user", {
      method: "PATCH",
      body: JSON.stringify({ name: 12345 }),
    })

    const response = await PATCH(req)
    expect(response.status).toBe(400)
  })

  it("should update user name successfully", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.user.update.mockResolvedValue({
      id: "user-1",
      name: "Alice",
      email: "alice@test.com",
      image: null,
      createdAt: new Date("2024-01-01"),
    })

    const { PATCH } = await import("@/app/api/user/route")
    const req = new Request("http://localhost/api/user", {
      method: "PATCH",
      body: JSON.stringify({ name: "Alice" }),
    })

    const response = await PATCH(req)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.name).toBe("Alice")
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { name: "Alice" },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        emailNotifications: true,
        createdAt: true,
      },
    })
  })
})
