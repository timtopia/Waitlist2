import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Prisma
const mockPrisma = {
  line: {
    findUnique: vi.fn(),
  },
  linePosition: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  transaction: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
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

// Mock fees
vi.mock("@/lib/fees", () => ({
  getPlatformFeePercent: vi.fn(() => 10),
  calculateFees: vi.fn((askingPrice: number, ownerFeePercent: number) => ({
    askingPrice,
    ownerFee: Math.round(askingPrice * ownerFeePercent) / 100,
    platformFee: Math.round(askingPrice * 10) / 100,
    ownerFeePercent,
    platformFeePercent: 10,
    totalPrice: askingPrice + Math.round(askingPrice * ownerFeePercent) / 100 + Math.round(askingPrice * 10) / 100,
  })),
}))

// Mock Stripe
const mockStripe = {
  checkout: {
    sessions: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
  },
}
vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => null), // default: dev mode (no Stripe)
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  performPositionSwap: vi.fn().mockResolvedValue(true),
}))

// Mock qrcode
vi.mock("qrcode", () => ({
  default: {
    toString: vi.fn().mockResolvedValue("<svg>mock-qr-code</svg>"),
  },
}))

// Mock settle-transactions
vi.mock("@/lib/settle-transactions", () => ({
  settleTransactionsForUser: vi.fn().mockResolvedValue(0),
}))

// ─── Fees Route ─────────────────────────────────────────────────────────────

describe("GET /api/lines/[lineId]/fees", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return fee percentages for an existing line", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({
      ownerFeePercent: 5,
    })

    const { GET } = await import("@/app/api/lines/[lineId]/fees/route")
    const req = new Request("http://localhost/api/lines/line-1/fees")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.ownerFeePercent).toBe(5)
    expect(data.platformFeePercent).toBe(10)
  })

  it("should return 404 if line not found", async () => {
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { GET } = await import("@/app/api/lines/[lineId]/fees/route")
    const req = new Request("http://localhost/api/lines/nonexistent/fees")

    const response = await GET(req, { params: Promise.resolve({ lineId: "nonexistent" }) })
    expect(response.status).toBe(404)

    const data = await response.json()
    expect(data.error).toContain("not found")
  })

  it("should return ownerFeePercent of 0 when line has no fee", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({
      ownerFeePercent: 0,
    })

    const { GET } = await import("@/app/api/lines/[lineId]/fees/route")
    const req = new Request("http://localhost/api/lines/line-1/fees")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.ownerFeePercent).toBe(0)
    expect(data.platformFeePercent).toBe(10)
  })
})

// ─── Market Route ───────────────────────────────────────────────────────────

describe("GET /api/lines/[lineId]/market", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return market data for a line with transactions", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1" })
    mockPrisma.transaction.findMany.mockResolvedValue([
      { amount: 10 },
      { amount: 20 },
      { amount: 30 },
    ])
    mockPrisma.linePosition.findMany.mockResolvedValue([
      { askingPrice: 15 },
      { askingPrice: 25 },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/market/route")
    const req = new Request("http://localhost/api/lines/line-1/market")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.avgPrice).toBe(20)
    expect(data.minPrice).toBe(10)
    expect(data.maxPrice).toBe(30)
    expect(data.volume).toBe(60)
    expect(data.count).toBe(3)
    expect(data.currentListings).toBe(2)
    expect(data.lowestAsk).toBe(15)
  })

  it("should return zeros when no transactions exist", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1" })
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.linePosition.findMany.mockResolvedValue([])

    const { GET } = await import("@/app/api/lines/[lineId]/market/route")
    const req = new Request("http://localhost/api/lines/line-1/market")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.avgPrice).toBe(0)
    expect(data.minPrice).toBe(0)
    expect(data.maxPrice).toBe(0)
    expect(data.volume).toBe(0)
    expect(data.count).toBe(0)
    expect(data.currentListings).toBe(0)
    expect(data.lowestAsk).toBeNull()
  })

  it("should return 404 if line not found", async () => {
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { GET } = await import("@/app/api/lines/[lineId]/market/route")
    const req = new Request("http://localhost/api/lines/nonexistent/market")

    const response = await GET(req, { params: Promise.resolve({ lineId: "nonexistent" }) })
    expect(response.status).toBe(404)

    const data = await response.json()
    expect(data.error).toContain("not found")
  })

  it("should return lowestAsk as null when no positions are for sale", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1" })
    mockPrisma.transaction.findMany.mockResolvedValue([
      { amount: 50 },
    ])
    mockPrisma.linePosition.findMany.mockResolvedValue([])

    const { GET } = await import("@/app/api/lines/[lineId]/market/route")
    const req = new Request("http://localhost/api/lines/line-1/market")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.count).toBe(1)
    expect(data.currentListings).toBe(0)
    expect(data.lowestAsk).toBeNull()
  })
})

// ─── QR Route ───────────────────────────────────────────────────────────────

describe("GET /api/lines/[lineId]/qr", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return an SVG QR code for an existing line", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1" })

    const { GET } = await import("@/app/api/lines/[lineId]/qr/route")
    const req = new Request("http://localhost/api/lines/line-1/qr")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const contentType = response.headers.get("Content-Type")
    expect(contentType).toBe("image/svg+xml")

    const body = await response.text()
    expect(body).toContain("svg")
  })

  it("should return 404 if line not found", async () => {
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { GET } = await import("@/app/api/lines/[lineId]/qr/route")
    const req = new Request("http://localhost/api/lines/nonexistent/qr")

    const response = await GET(req, { params: Promise.resolve({ lineId: "nonexistent" }) })
    expect(response.status).toBe(404)
  })

  it("should accept custom size parameter", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1" })

    const QRCode = await import("qrcode")
    const { GET } = await import("@/app/api/lines/[lineId]/qr/route")
    const req = new Request("http://localhost/api/lines/line-1/qr?size=500")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    expect(QRCode.default.toString).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ width: 500 })
    )
  })

  it("should accept custom dark and light color parameters", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1" })

    const QRCode = await import("qrcode")
    const { GET } = await import("@/app/api/lines/[lineId]/qr/route")
    const req = new Request("http://localhost/api/lines/line-1/qr?dark=ff0000&light=00ff00")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    expect(QRCode.default.toString).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        color: { dark: "#ff0000", light: "#00ff00" },
      })
    )
  })

  it("should clamp size to minimum 100", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1" })

    const QRCode = await import("qrcode")
    const { GET } = await import("@/app/api/lines/[lineId]/qr/route")
    const req = new Request("http://localhost/api/lines/line-1/qr?size=10")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    expect(QRCode.default.toString).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ width: 100 })
    )
  })

  it("should clamp size to maximum 1000", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1" })

    const QRCode = await import("qrcode")
    const { GET } = await import("@/app/api/lines/[lineId]/qr/route")
    const req = new Request("http://localhost/api/lines/line-1/qr?size=5000")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    expect(QRCode.default.toString).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ width: 1000 })
    )
  })

  it("should fall back to default colors for invalid hex values", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1" })

    const QRCode = await import("qrcode")
    const { GET } = await import("@/app/api/lines/[lineId]/qr/route")
    const req = new Request("http://localhost/api/lines/line-1/qr?dark=xyz&light=not-hex")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    expect(QRCode.default.toString).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        color: { dark: "#000000", light: "#ffffff" },
      })
    )
  })
})

// ─── Cancel Payment Route ───────────────────────────────────────────────────

describe("GET /api/lines/[lineId]/cancel-payment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
      return fn(mockPrisma)
    })
  })

  it("should unlock positions and mark transaction as FAILED, then redirect", async () => {
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 2 })
    mockPrisma.transaction.update.mockResolvedValue({ id: "txn-1", status: "FAILED" })

    const { GET } = await import("@/app/api/lines/[lineId]/cancel-payment/route")
    const req = new Request(
      "http://localhost/api/lines/line-1/cancel-payment?transaction_id=txn-1"
    )

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    // Should redirect (3xx)
    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)

    const location = response.headers.get("Location")
    expect(location).toContain("/lines/line-1")
    expect(location).toContain("payment=cancelled")

    // Verify positions were unlocked
    expect(mockPrisma.linePosition.updateMany).toHaveBeenCalledWith({
      where: { lockedBy: "txn-1" },
      data: { lockedUntil: null, lockedBy: null },
    })

    // Verify transaction was marked as FAILED
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "txn-1" },
      data: { status: "FAILED" },
    })
  })

  it("should redirect even without transaction_id", async () => {
    const { GET } = await import("@/app/api/lines/[lineId]/cancel-payment/route")
    const req = new Request("http://localhost/api/lines/line-1/cancel-payment")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)

    const location = response.headers.get("Location")
    expect(location).toContain("/lines/line-1")
    expect(location).toContain("payment=cancelled")

    // No DB calls should have been made
    expect(mockPrisma.linePosition.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.transaction.update).not.toHaveBeenCalled()
  })

  it("should redirect even if DB cleanup fails", async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error("DB error"))

    const { GET } = await import("@/app/api/lines/[lineId]/cancel-payment/route")
    const req = new Request(
      "http://localhost/api/lines/line-1/cancel-payment?transaction_id=txn-1"
    )

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    // Should still redirect
    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)

    const location = response.headers.get("Location")
    expect(location).toContain("/lines/line-1")
    expect(location).toContain("payment=cancelled")
  })
})

// ─── Checkout Route (dev mode) ──────────────────────────────────────────────

describe("POST /api/lines/[lineId]/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
      return fn(mockPrisma)
    })
  })

  it("should return 401 if not authenticated", async () => {
    mockAuth.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/checkout", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(401)
  })

  it("should return 400 if line is paused (inactive)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "buyer-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      isActive: false,
    })

    const { POST } = await import("@/app/api/lines/[lineId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/checkout", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toContain("paused")
  })

  it("should return 400 if line not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "buyer-1" } })
    mockPrisma.line.findUnique.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/checkout", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)
  })

  it("should return 400 if buyer is not in the line", async () => {
    mockAuth.mockResolvedValue({ user: { id: "buyer-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      isActive: true,
    })
    mockPrisma.linePosition.findUnique.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/checkout", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toContain("must be in the line")
  })

  it("should return 400 if buyer is already first in line", async () => {
    mockAuth.mockResolvedValue({ user: { id: "buyer-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      isActive: true,
    })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-buyer",
      lineId: "line-1",
      userId: "buyer-1",
      position: 1,
      lockedUntil: null,
    })

    const { POST } = await import("@/app/api/lines/[lineId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/checkout", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toContain("already first")
  })

  it("should return 400 if no one is in front", async () => {
    mockAuth.mockResolvedValue({ user: { id: "buyer-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      isActive: true,
    })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-buyer",
      lineId: "line-1",
      userId: "buyer-1",
      position: 2,
      lockedUntil: null,
    })
    mockPrisma.linePosition.findFirst.mockResolvedValue(null)

    const { POST } = await import("@/app/api/lines/[lineId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/checkout", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toContain("No one in front")
  })

  it("should return 400 if target position is not for sale", async () => {
    mockAuth.mockResolvedValue({ user: { id: "buyer-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      isActive: true,
    })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-buyer",
      lineId: "line-1",
      userId: "buyer-1",
      position: 2,
      lockedUntil: null,
    })
    mockPrisma.linePosition.findFirst.mockResolvedValue({
      id: "pos-seller",
      lineId: "line-1",
      userId: "seller-1",
      position: 1,
      askingPrice: null,
      lockedUntil: null,
      user: { name: "Seller" },
      line: { name: "Test Line", ownerFeePercent: 5 },
    })

    const { POST } = await import("@/app/api/lines/[lineId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/checkout", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toContain("not for sale")
  })

  it("should return 409 if buyer position is locked", async () => {
    mockAuth.mockResolvedValue({ user: { id: "buyer-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      isActive: true,
    })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-buyer",
      lineId: "line-1",
      userId: "buyer-1",
      position: 2,
      lockedUntil: new Date(Date.now() + 60000), // locked for 1 minute
    })
    mockPrisma.linePosition.findFirst.mockResolvedValue({
      id: "pos-seller",
      lineId: "line-1",
      userId: "seller-1",
      position: 1,
      askingPrice: 25,
      lockedUntil: null,
      user: { name: "Seller" },
      line: { name: "Test Line", ownerFeePercent: 5 },
    })

    const { POST } = await import("@/app/api/lines/[lineId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/checkout", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(409)

    const data = await response.json()
    expect(data.error).toContain("another transaction")
  })

  it("should return 409 if target position is locked", async () => {
    mockAuth.mockResolvedValue({ user: { id: "buyer-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      isActive: true,
    })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-buyer",
      lineId: "line-1",
      userId: "buyer-1",
      position: 2,
      lockedUntil: null,
    })
    mockPrisma.linePosition.findFirst.mockResolvedValue({
      id: "pos-seller",
      lineId: "line-1",
      userId: "seller-1",
      position: 1,
      askingPrice: 25,
      lockedUntil: new Date(Date.now() + 60000), // locked for 1 minute
      user: { name: "Seller" },
      line: { name: "Test Line", ownerFeePercent: 5 },
    })

    const { POST } = await import("@/app/api/lines/[lineId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/checkout", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(409)

    const data = await response.json()
    expect(data.error).toContain("another transaction")
  })

  it("should complete swap in dev mode (no Stripe) successfully", async () => {
    mockAuth.mockResolvedValue({ user: { id: "buyer-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      isActive: true,
    })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-buyer",
      lineId: "line-1",
      userId: "buyer-1",
      position: 2,
      lockedUntil: null,
    })
    mockPrisma.linePosition.findFirst.mockResolvedValue({
      id: "pos-seller",
      lineId: "line-1",
      userId: "seller-1",
      position: 1,
      askingPrice: 25,
      lockedUntil: null,
      user: { name: "Seller" },
      line: { name: "Test Line", ownerFeePercent: 5 },
    })
    mockPrisma.transaction.create.mockResolvedValue({
      id: "txn-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      lineId: "line-1",
      amount: 25,
      status: "PENDING",
    })

    const { POST } = await import("@/app/api/lines/[lineId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/checkout", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.devMode).toBe(true)
  })

  it("should return 500 if dev mode swap fails", async () => {
    mockAuth.mockResolvedValue({ user: { id: "buyer-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      isActive: true,
    })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-buyer",
      lineId: "line-1",
      userId: "buyer-1",
      position: 2,
      lockedUntil: null,
    })
    mockPrisma.linePosition.findFirst.mockResolvedValue({
      id: "pos-seller",
      lineId: "line-1",
      userId: "seller-1",
      position: 1,
      askingPrice: 25,
      lockedUntil: null,
      user: { name: "Seller" },
      line: { name: "Test Line", ownerFeePercent: 5 },
    })
    mockPrisma.transaction.create.mockResolvedValue({
      id: "txn-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      lineId: "line-1",
      amount: 25,
      status: "PENDING",
    })

    // Make performPositionSwap return false
    const stripeModule = await import("@/lib/stripe")
    vi.mocked(stripeModule.performPositionSwap).mockResolvedValueOnce(false)

    const { POST } = await import("@/app/api/lines/[lineId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/checkout", {
      method: "POST",
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(500)

    const data = await response.json()
    expect(data.error).toContain("swap")
  })
})

// ─── Complete Payment Route ─────────────────────────────────────────────────

describe("GET /api/lines/[lineId]/complete-payment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should redirect with error when session_id is missing", async () => {
    const { GET } = await import("@/app/api/lines/[lineId]/complete-payment/route")
    const req = new Request("http://localhost/api/lines/line-1/complete-payment")

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)

    const location = response.headers.get("Location")
    expect(location).toContain("/lines/line-1")
    expect(location).toContain("payment=error")
    expect(location).toContain("missing_session")
  })

  it("should redirect with error when Stripe is not configured", async () => {
    // getStripe already returns null by default in our mock

    const { GET } = await import("@/app/api/lines/[lineId]/complete-payment/route")
    const req = new Request(
      "http://localhost/api/lines/line-1/complete-payment?session_id=cs_test_123"
    )

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)

    const location = response.headers.get("Location")
    expect(location).toContain("payment=error")
    expect(location).toContain("stripe_not_configured")
  })

  it("should redirect with error when payment is not paid", async () => {
    const stripeModule = await import("@/lib/stripe")
    vi.mocked(stripeModule.getStripe).mockReturnValueOnce(mockStripe as any)
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      payment_status: "unpaid",
      metadata: { transactionId: "txn-1" },
    })

    const { GET } = await import("@/app/api/lines/[lineId]/complete-payment/route")
    const req = new Request(
      "http://localhost/api/lines/line-1/complete-payment?session_id=cs_test_123"
    )

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)

    const location = response.headers.get("Location")
    expect(location).toContain("payment=error")
    expect(location).toContain("not_paid")
  })

  it("should redirect with error when metadata has no transactionId", async () => {
    const stripeModule = await import("@/lib/stripe")
    vi.mocked(stripeModule.getStripe).mockReturnValueOnce(mockStripe as any)
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      payment_status: "paid",
      metadata: {},
    })

    const { GET } = await import("@/app/api/lines/[lineId]/complete-payment/route")
    const req = new Request(
      "http://localhost/api/lines/line-1/complete-payment?session_id=cs_test_123"
    )

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)

    const location = response.headers.get("Location")
    expect(location).toContain("payment=error")
    expect(location).toContain("no_transaction")
  })

  it("should redirect with error when transaction not found", async () => {
    const stripeModule = await import("@/lib/stripe")
    vi.mocked(stripeModule.getStripe).mockReturnValueOnce(mockStripe as any)
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      payment_status: "paid",
      metadata: { transactionId: "txn-1" },
    })
    mockPrisma.transaction.findUnique.mockResolvedValue(null)

    const { GET } = await import("@/app/api/lines/[lineId]/complete-payment/route")
    const req = new Request(
      "http://localhost/api/lines/line-1/complete-payment?session_id=cs_test_123"
    )

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)

    const location = response.headers.get("Location")
    expect(location).toContain("payment=error")
    expect(location).toContain("invalid_transaction")
  })

  it("should redirect with error when transaction belongs to wrong line", async () => {
    const stripeModule = await import("@/lib/stripe")
    vi.mocked(stripeModule.getStripe).mockReturnValueOnce(mockStripe as any)
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      payment_status: "paid",
      metadata: { transactionId: "txn-1" },
    })
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: "txn-1",
      lineId: "other-line", // wrong line
    })

    const { GET } = await import("@/app/api/lines/[lineId]/complete-payment/route")
    const req = new Request(
      "http://localhost/api/lines/line-1/complete-payment?session_id=cs_test_123"
    )

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)

    const location = response.headers.get("Location")
    expect(location).toContain("payment=error")
    expect(location).toContain("invalid_transaction")
  })

  it("should perform swap and redirect to success on valid payment", async () => {
    const stripeModule = await import("@/lib/stripe")
    vi.mocked(stripeModule.getStripe).mockReturnValueOnce(mockStripe as any)
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      payment_status: "paid",
      metadata: { transactionId: "txn-1" },
    })
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: "txn-1",
      lineId: "line-1",
    })
    vi.mocked(stripeModule.performPositionSwap).mockResolvedValueOnce(true)

    const { GET } = await import("@/app/api/lines/[lineId]/complete-payment/route")
    const req = new Request(
      "http://localhost/api/lines/line-1/complete-payment?session_id=cs_test_123"
    )

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)

    const location = response.headers.get("Location")
    expect(location).toContain("/lines/line-1")
    expect(location).toContain("payment=success")

    expect(stripeModule.performPositionSwap).toHaveBeenCalledWith("txn-1")
  })

  it("should redirect with generic error when Stripe retrieve throws", async () => {
    const stripeModule = await import("@/lib/stripe")
    vi.mocked(stripeModule.getStripe).mockReturnValueOnce(mockStripe as any)
    mockStripe.checkout.sessions.retrieve.mockRejectedValue(new Error("Stripe error"))

    const { GET } = await import("@/app/api/lines/[lineId]/complete-payment/route")
    const req = new Request(
      "http://localhost/api/lines/line-1/complete-payment?session_id=cs_test_123"
    )

    const response = await GET(req, { params: Promise.resolve({ lineId: "line-1" }) })

    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)

    const location = response.headers.get("Location")
    expect(location).toContain("payment=error")
  })
})
