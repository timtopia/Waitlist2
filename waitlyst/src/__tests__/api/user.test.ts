import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  user: { findUnique: vi.fn(), update: vi.fn() },
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))
vi.mock("@/lib/stripe", () => ({ getStripe: () => null }))

let userCounter = 0
const patch = (body: string) =>
  new Request("http://localhost/api/user", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  })

describe("PATCH /api/user", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // A fresh user per test so the per-user rate limit never interferes
    mockAuth.mockResolvedValue({ user: { id: `user-${++userCounter}` } })
  })

  it("rejects a malformed body with a 400, not a server error", async () => {
    const { PATCH } = await import("@/app/api/user/route")
    const res = await PATCH(patch("{not json"))
    expect(res.status).toBe(400)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it("rejects a body that isn't an object", async () => {
    const { PATCH } = await import("@/app/api/user/route")
    expect((await PATCH(patch("null"))).status).toBe(400)
    expect((await PATCH(patch("[1]"))).status).toBe(400)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it("updates a trimmed name", async () => {
    mockPrisma.user.update.mockResolvedValue({ id: "u", name: "Jane" })
    const { PATCH } = await import("@/app/api/user/route")
    const res = await PATCH(patch(JSON.stringify({ name: "  Jane  " })))
    expect(res.status).toBe(200)
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "Jane" } })
    )
  })

  it("requires sign-in", async () => {
    mockAuth.mockResolvedValue(null)
    const { PATCH } = await import("@/app/api/user/route")
    expect((await PATCH(patch("{}"))).status).toBe(401)
  })
})
