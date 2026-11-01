import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  line: { findUnique: vi.fn() },
  linePosition: { findFirst: vi.fn(), update: vi.fn() },
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))

const give = async (positionId: unknown = "pos-1") => {
  const { POST } = await import("@/app/api/lines/[lineId]/grace/route")
  return POST(
    new Request("http://localhost/api/lines/line-1/grace", { method: "POST", body: JSON.stringify({ positionId }) }),
    { params: Promise.resolve({ lineId: "line-1" }) }
  )
}

describe("POST /api/lines/[lineId]/grace", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })
  })

  it("gives a called party five more minutes without re-calling them", async () => {
    mockPrisma.linePosition.findFirst.mockResolvedValue({ id: "pos-1", graceMinutes: 0 })
    mockPrisma.linePosition.update.mockResolvedValue({ graceMinutes: 5 })

    const res = await give()

    expect(res.status).toBe(200)
    expect(mockPrisma.linePosition.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "pos-1", lineId: "line-1", fulfilled: false, calledAt: { not: null } },
    }))
    expect(mockPrisma.linePosition.update).toHaveBeenCalledWith({
      where: { id: "pos-1" },
      data: { graceMinutes: { increment: 5 } },
      select: { graceMinutes: true },
    })
  })

  it("is for the host only", async () => {
    mockAuth.mockResolvedValue({ user: { id: "guest-1" } })
    expect((await give()).status).toBe(403)
    expect(mockPrisma.linePosition.update).not.toHaveBeenCalled()
  })

  it("caps the extra time", async () => {
    mockPrisma.linePosition.findFirst.mockResolvedValue({ id: "pos-1", graceMinutes: 60 })
    expect((await give()).status).toBe(400)
    expect(mockPrisma.linePosition.update).not.toHaveBeenCalled()
  })

  it("refuses a party that isn't waiting on a call", async () => {
    mockPrisma.linePosition.findFirst.mockResolvedValue(null)
    expect((await give()).status).toBe(404)
  })
})
