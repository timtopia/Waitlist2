import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Prisma
const mockPrisma = {
  line: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  linePosition: {
    findFirst: vi.fn(),
    delete: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  transaction: {
    update: vi.fn(),
  },
  user: {
    update: vi.fn(),
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

// Mock events
vi.mock("@/lib/events", () => ({
  lineEvents: { emit: vi.fn() },
}))

// Mock settle-transactions
vi.mock("@/lib/settle-transactions", () => ({
  settleTransactionsForUser: vi.fn().mockResolvedValue(0),
}))

// Mock fees
vi.mock("@/lib/fees", () => ({
  getPlatformFeePercent: vi.fn(() => 10),
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
      data: { isActive: false },
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
      data: { isActive: true },
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
    expect(mockPrisma.line.create).toHaveBeenCalledWith({
      data: {
        name: "My Line (Copy)",
        description: "A test line",
        createdById: "owner-1",
        isPublic: true,
        isActive: true,
        maxCapacity: 50,
        ownerFeePercent: 5,
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

  it("should return 400 if not line owner", async () => {
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
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("creator")
  })

  it("should return 400 if line not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/remove-front/route")
    const req = new Request("http://localhost/api/lines/line-1/remove-front", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("not found")
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
      user: { name: "Alice" },
    })
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
      user: { name: "Bob" },
    })
    mockPrisma.transaction.update.mockResolvedValue({ id: "txn-pending", status: "FAILED" })
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 0 })
    mockPrisma.linePosition.delete.mockResolvedValue({ id: "pos-1" })

    const { POST } = await import("@/app/api/lines/[lineId]/remove-front/route")
    const req = new Request("http://localhost/api/lines/line-1/remove-front", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "txn-pending" },
      data: { status: "FAILED" },
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
        createdAt: true,
      },
    })
  })
})
