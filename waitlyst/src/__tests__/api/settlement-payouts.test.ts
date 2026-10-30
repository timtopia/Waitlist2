import { describe, it, expect, vi, beforeEach } from "vitest"
import { sanitizeReturnPath } from "@/lib/validate"

const mockPrisma = {
  line: { findUnique: vi.fn() },
  transaction: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  linePosition: { findMany: vi.fn() },
  queueVisit: { findMany: vi.fn().mockResolvedValue([]) },
}

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))

describe("sanitizeReturnPath", () => {
  it("allows a plain internal path", () => {
    expect(sanitizeReturnPath("/lines/abc/settlement", "/profile")).toBe("/lines/abc/settlement")
  })

  it("falls back for a protocol-relative path (open redirect risk)", () => {
    expect(sanitizeReturnPath("//evil.example.com/phish", "/profile")).toBe("/profile")
  })

  it("falls back for a full external URL", () => {
    expect(sanitizeReturnPath("https://evil.example.com", "/profile")).toBe("/profile")
  })

  it("falls back for a non-string value", () => {
    expect(sanitizeReturnPath(null, "/profile")).toBe("/profile")
    expect(sanitizeReturnPath(undefined, "/profile")).toBe("/profile")
    expect(sanitizeReturnPath(42, "/profile")).toBe("/profile")
  })

  it("falls back for a path that doesn't start with /", () => {
    expect(sanitizeReturnPath("profile", "/profile")).toBe("/profile")
  })
})

describe("GET /api/lines/[lineId]/settlement -- owner fee totals", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reports the owner's fee earnings separately from the seller's take, split by captured vs. pending", async () => {
    // Regression test: the settlement summary used to have no visibility
    // into how much the OWNER actually earns (ownerFee), as distinct from
    // totalAmount/capturedAmount which track the seller's side -- so an
    // owner had no way to see "how much can I pull out" on this page.
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })
    mockPrisma.transaction.findMany.mockResolvedValue([
      {
        id: "txn-captured",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        amount: 90,
        ownerFee: 9,
        platformFee: 4.5,
        status: "COMPLETED",
        settledAt: new Date("2025-06-01T10:00:00Z"),
        stripePaymentId: null,
        createdAt: new Date("2025-06-01T09:00:00Z"),
      },
      {
        id: "txn-pending",
        buyerId: "buyer-2",
        sellerId: "seller-2",
        amount: 50,
        ownerFee: 5,
        platformFee: 2.5,
        status: "COMPLETED",
        settledAt: null,
        stripePaymentId: null,
        createdAt: new Date("2025-06-01T11:00:00Z"),
      },
    ])
    mockPrisma.user.findMany.mockResolvedValue([])
    mockPrisma.linePosition.findMany.mockResolvedValue([])

    const { GET } = await import("@/app/api/lines/[lineId]/settlement/route")
    const req = new Request("http://localhost/api/lines/line-1/settlement")
    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.summary.ownerFeeCaptured).toBe(9)
    expect(data.summary.ownerFeePending).toBe(5)
    // Each transaction row must carry its own ownerFee so the client can
    // keep the owner-fee totals in sync on optimistic UI updates.
    expect(data.transactions.find((t: { id: string }) => t.id === "txn-captured").ownerFee).toBe(9)
    expect(data.transactions.find((t: { id: string }) => t.id === "txn-pending").ownerFee).toBe(5)
  })
})
