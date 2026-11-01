import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  linePosition: { findUnique: vi.fn() },
  transaction: { findFirst: vi.fn() },
  swapOffer: { count: vi.fn() },
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))
const abandonPendingTransaction = vi.fn()
const sessionsRetrieve = vi.fn()
vi.mock("@/lib/stripe", () => ({
  abandonPendingTransaction: (...args: unknown[]) => abandonPendingTransaction(...args),
  getStripe: () => ({ checkout: { sessions: { retrieve: sessionsRetrieve } } }),
}))

const ctx = { params: Promise.resolve({ lineId: "line-1" }) }
const locked = () => ({ lockedBy: "txn-1", lockedUntil: new Date(Date.now() + 10 * 60_000) })

describe("/api/lines/[lineId]/my-checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "buyer-1" } })
    mockPrisma.swapOffer.count.mockResolvedValue(0)
  })

  it("hands the buyer back the payment page they closed", async () => {
    mockPrisma.linePosition.findUnique.mockResolvedValue(locked())
    mockPrisma.transaction.findFirst.mockResolvedValue({ id: "txn-1", stripePaymentId: "cs_1" })
    sessionsRetrieve.mockResolvedValue({ status: "open", url: "https://stripe.test/cs_1" })
    const { GET } = await import("@/app/api/lines/[lineId]/my-checkout/route")

    const data = await (await GET(new Request("http://localhost/x"), ctx)).json()

    expect(data).toEqual({ pending: true, url: "https://stripe.test/cs_1" })
    expect(mockPrisma.transaction.findFirst).toHaveBeenCalledWith({
      where: { id: "txn-1", lineId: "line-1", buyerId: "buyer-1", status: "PENDING" },
    })
  })

  it("offers nothing to a seller whose spot someone else is paying for, or for an accepted offer", async () => {
    mockPrisma.linePosition.findUnique.mockResolvedValue(locked())
    mockPrisma.transaction.findFirst.mockResolvedValue(null)
    const { GET } = await import("@/app/api/lines/[lineId]/my-checkout/route")
    expect(await (await GET(new Request("http://localhost/x"), ctx)).json()).toEqual({ pending: false })

    mockPrisma.transaction.findFirst.mockResolvedValue({ id: "txn-1", stripePaymentId: "cs_1" })
    mockPrisma.swapOffer.count.mockResolvedValue(1)
    expect(await (await GET(new Request("http://localhost/x"), ctx)).json()).toEqual({ pending: false })
  })

  it("cancels the buyer's own purchase, counting it as theirs", async () => {
    mockPrisma.linePosition.findUnique.mockResolvedValue(locked())
    mockPrisma.transaction.findFirst.mockResolvedValue({ id: "txn-1", stripePaymentId: "cs_1" })
    const { DELETE } = await import("@/app/api/lines/[lineId]/my-checkout/route")

    const res = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), ctx)

    expect(res.status).toBe(200)
    expect(abandonPendingTransaction).toHaveBeenCalledWith("txn-1", { byBuyer: true })
  })

  it("refuses to cancel when there's nothing of theirs to cancel", async () => {
    mockPrisma.linePosition.findUnique.mockResolvedValue({ lockedBy: null, lockedUntil: null })
    const { DELETE } = await import("@/app/api/lines/[lineId]/my-checkout/route")

    expect((await DELETE(new Request("http://localhost/x", { method: "DELETE" }), ctx)).status).toBe(404)
    expect(abandonPendingTransaction).not.toHaveBeenCalled()
  })
})
