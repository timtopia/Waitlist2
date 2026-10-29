import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  line: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  linePosition: {
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  transaction: {
    findMany: vi.fn(),
  },
}

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }))

const params = { params: Promise.resolve({ lineId: "line-1" }) }

function asOwner() {
  mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
  mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })
}

describe("POST /api/lines/[lineId]/call-next", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calls the first person who hasn't been served yet, not simply position 1", async () => {
    asOwner()
    mockPrisma.linePosition.findFirst.mockResolvedValue({
      id: "pos-2",
      position: 2,
      user: { name: "Bob", email: null, emailNotifications: false },
    })
    mockPrisma.line.update.mockResolvedValue({ id: "line-1", name: "Line" })

    const { POST } = await import("@/app/api/lines/[lineId]/call-next/route")
    const res = await POST(new Request("http://localhost/api/lines/line-1/call-next", { method: "POST" }), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ calledUser: "Bob", position: 2, positionId: "pos-2" })
    expect(mockPrisma.linePosition.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lineId: "line-1", fulfilled: false },
        orderBy: { position: "asc" },
      })
    )
    expect(mockPrisma.line.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nowServing: "Bob" }) })
    )
  })

  it("says everyone has been served when only served people remain", async () => {
    asOwner()
    mockPrisma.linePosition.findFirst.mockResolvedValue(null)
    mockPrisma.linePosition.count.mockResolvedValue(3)

    const { POST } = await import("@/app/api/lines/[lineId]/call-next/route")
    const res = await POST(new Request("http://localhost/api/lines/line-1/call-next", { method: "POST" }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Everyone in line has already been served")
    expect(mockPrisma.line.update).not.toHaveBeenCalled()
  })

  it("says no one is in line when the line is empty", async () => {
    asOwner()
    mockPrisma.linePosition.findFirst.mockResolvedValue(null)
    mockPrisma.linePosition.count.mockResolvedValue(0)

    const { POST } = await import("@/app/api/lines/[lineId]/call-next/route")
    const res = await POST(new Request("http://localhost/api/lines/line-1/call-next", { method: "POST" }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("No one in line to call")
  })

  it("rejects non-owners", async () => {
    mockAuth.mockResolvedValue({ user: { id: "someone-else" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })

    const { POST } = await import("@/app/api/lines/[lineId]/call-next/route")
    const res = await POST(new Request("http://localhost/api/lines/line-1/call-next", { method: "POST" }), params)

    expect(res.status).toBe(403)
    expect(mockPrisma.linePosition.findFirst).not.toHaveBeenCalled()
  })
})

describe("GET /api/lines/[lineId]/stats -- owner fee earnings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reports the owner's own fee cut separately from swap volume", async () => {
    asOwner()
    mockPrisma.transaction.findMany.mockResolvedValue([
      { id: "t1", status: "COMPLETED", amount: 100, ownerFee: 10, settledAt: new Date(), createdAt: new Date() },
      { id: "t2", status: "COMPLETED", amount: 40, ownerFee: 4, settledAt: null, createdAt: new Date() },
      { id: "t3", status: "REFUNDED", amount: 30, ownerFee: 3, settledAt: new Date(), createdAt: new Date() },
      { id: "t4", status: "PENDING", amount: 20, ownerFee: 2, settledAt: null, createdAt: new Date() },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/stats/route")
    const res = await GET(new Request("http://localhost/api/lines/line-1/stats"), params)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ownerFeeEarned).toBe(10)
    expect(data.ownerFeePending).toBe(4)
    expect(data.totalCompleted).toBe(100)
  })
})
