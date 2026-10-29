import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Prisma
const mockPrisma = {
  line: {
    findUnique: vi.fn(),
  },
  linePosition: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  swapOffer: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  transaction: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
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
let mockStripeConfigured = true
vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => (mockStripeConfigured ? mockStripe : null)),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  performPositionSwap: vi.fn().mockResolvedValue(true),
  captureAuthorization: vi.fn().mockResolvedValue(100),
  releaseFunds: vi.fn().mockResolvedValue(true),
  lockPositionsForTransaction: vi.fn().mockResolvedValue(true),
  abandonPendingTransaction: vi.fn().mockResolvedValue(true),
}))

// Mock email (fire-and-forget, never awaited by the route logic we test)
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/email-templates", () => ({
  swapAcceptedEmail: vi.fn(() => ({ subject: "s", html: "h" })),
  fulfilledEmail: vi.fn(() => ({ subject: "s", html: "h" })),
}))

describe("PATCH /api/lines/[lineId]/offer/[offerId] (accept)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStripeConfigured = true
  })

  it("never hands the Stripe checkout URL to the seller who called accept", async () => {
    // Regression test: accepting used to redirect the SELLER's own browser to
    // pay for their own position. The buyer (offer.fromUserId) is the only
    // one who owes money, and must fetch their own link separately.
    mockAuth.mockResolvedValue({ user: { id: "seller-1" } }) // the recipient accepts
    mockPrisma.swapOffer.findUnique.mockResolvedValue({
      id: "offer-1",
      lineId: "line-1",
      fromUserId: "buyer-1",
      toUserId: "seller-1",
      amount: 90,
      status: "PENDING",
    })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      isActive: true,
      allowResale: true,
      createdById: "owner-1",
      name: "Test Line",
    })
    mockPrisma.linePosition.findUnique
      .mockResolvedValueOnce({ id: "pos-buyer", lockedUntil: null, position: 2 }) // buyerPosition
      .mockResolvedValueOnce({
        id: "pos-seller",
        lockedUntil: null,
        position: 1,
        user: { name: "Seller" },
        line: { name: "Test Line" },
      }) // sellerPosition
    mockPrisma.user.findUnique.mockResolvedValue({ name: "Buyer", email: null, emailNotifications: false })
    mockPrisma.transaction.create.mockResolvedValue({ id: "txn-1" })
    mockStripe.checkout.sessions.create.mockResolvedValue({ id: "cs_123", url: "https://stripe.test/pay" })

    const { PATCH } = await import("@/app/api/lines/[lineId]/offer/[offerId]/route")
    const req = new Request("http://localhost/api/lines/line-1/offer/offer-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "accept" }),
    })

    const response = await PATCH(req, {
      params: Promise.resolve({ lineId: "line-1", offerId: "offer-1" }),
    })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.checkoutUrl).toBeUndefined()
    expect(data.pendingBuyerPayment).toBe(true)
  })
})

describe("PATCH /api/lines/[lineId]/offer/[offerId] (accept) -- conflicting offers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStripeConfigured = false // exercise the dev-mode swap path, like a real sequential accept would
  })

  it("rejects accepting an offer that went stale because an earlier swap already moved the queue", async () => {
    // Regression test for: 2 offers to 1, 3 offers to 2, 1 accepts 2 (swap
    // happens, so the person who was "2" is now "1"), then 2 accepts 3 --
    // except "2" no longer means the same person/position it did when that
    // offer was created. Accepting it would let the far offerer (3) skip
    // straight past whoever is now in between, instead of moving up one
    // spot as the offer implied. This must be rejected, not silently swapped.
    mockPrisma.swapOffer.findUnique.mockResolvedValue({
      id: "offer-carol-to-bob",
      lineId: "line-1",
      fromUserId: "carol",
      toUserId: "bob",
      amount: 10,
      status: "PENDING",
    })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      isActive: true,
      allowResale: true,
      createdById: "owner-1",
      name: "Test Line",
    })

    // After an earlier swap, Bob (the offer's recipient/"seller") is now at
    // position 1, but Carol (the offerer/"buyer") is still at position 3 --
    // Alice sits between them at position 2. They're no longer adjacent.
    mockPrisma.linePosition.findUnique
      .mockResolvedValueOnce({ id: "pos-carol", lockedUntil: null, position: 3 }) // buyerPosition (fromUserId)
      .mockResolvedValueOnce({
        id: "pos-bob",
        lockedUntil: null,
        position: 1,
        user: { name: "Bob" },
        line: { name: "Test Line" },
      }) // sellerPosition (toUserId)

    const { PATCH } = await import("@/app/api/lines/[lineId]/offer/[offerId]/route")
    const req = new Request("http://localhost/api/lines/line-1/offer/offer-carol-to-bob", {
      method: "PATCH",
      body: JSON.stringify({ action: "accept" }),
    })

    // Bob (toUserId) is the one who responds to the offer.
    mockAuth.mockResolvedValue({ user: { id: "bob" } })

    const response = await PATCH(req, {
      params: Promise.resolve({ lineId: "line-1", offerId: "offer-carol-to-bob" }),
    })
    expect(response.status).toBe(409)

    const data = await response.json()
    expect(data.error).toMatch(/no longer valid/i)

    // The stale offer should be marked DECLINED, not left PENDING to be
    // retried, and no transaction/position-swap should ever have been created.
    expect(mockPrisma.swapOffer.update).toHaveBeenCalledWith({
      where: { id: "offer-carol-to-bob" },
      data: { status: "DECLINED" },
    })
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled()
  })

  it("still allows accepting when the offerer really is directly behind the recipient", async () => {
    mockAuth.mockResolvedValue({ user: { id: "alice" } }) // alice is offer.toUserId -- she's the one who can accept
    mockPrisma.swapOffer.findUnique.mockResolvedValue({
      id: "offer-bob-to-alice",
      lineId: "line-1",
      fromUserId: "bob",
      toUserId: "alice",
      amount: 10,
      status: "PENDING",
    })
    mockPrisma.line.findUnique.mockResolvedValue({
      id: "line-1",
      isActive: true,
      allowResale: true,
      createdById: "owner-1",
      name: "Test Line",
    })
    mockPrisma.linePosition.findUnique
      .mockResolvedValueOnce({ id: "pos-bob", lockedUntil: null, position: 2 }) // buyerPosition
      .mockResolvedValueOnce({
        id: "pos-alice",
        lockedUntil: null,
        position: 1,
        user: { name: "Alice" },
        line: { name: "Test Line" },
      }) // sellerPosition -- directly in front, still adjacent
    mockPrisma.transaction.create.mockResolvedValue({ id: "txn-1" })

    const { PATCH } = await import("@/app/api/lines/[lineId]/offer/[offerId]/route")
    const req = new Request("http://localhost/api/lines/line-1/offer/offer-bob-to-alice", {
      method: "PATCH",
      body: JSON.stringify({ action: "accept" }),
    })

    const response = await PATCH(req, {
      params: Promise.resolve({ lineId: "line-1", offerId: "offer-bob-to-alice" }),
    })
    expect(response.status).toBe(200)
  })
})

describe("GET /api/lines/[lineId]/offer/[offerId]/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStripeConfigured = true
  })

  it("lets the buyer who made the offer fetch the checkout link", async () => {
    mockAuth.mockResolvedValue({ user: { id: "buyer-1" } })
    mockPrisma.swapOffer.findUnique.mockResolvedValue({
      id: "offer-1",
      lineId: "line-1",
      fromUserId: "buyer-1",
      toUserId: "seller-1",
      status: "ACCEPTED",
    })
    mockPrisma.transaction.findFirst.mockResolvedValue({
      id: "txn-1",
      stripePaymentId: "cs_123",
    })
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({ url: "https://stripe.test/pay" })

    const { GET } = await import("@/app/api/lines/[lineId]/offer/[offerId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/offer/offer-1/checkout")

    const response = await GET(req, {
      params: Promise.resolve({ lineId: "line-1", offerId: "offer-1" }),
    })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.checkoutUrl).toBe("https://stripe.test/pay")
  })

  it("refuses to hand the checkout link to anyone but the buyer", async () => {
    mockAuth.mockResolvedValue({ user: { id: "seller-1" } }) // not the offer's buyer
    mockPrisma.swapOffer.findUnique.mockResolvedValue({
      id: "offer-1",
      lineId: "line-1",
      fromUserId: "buyer-1",
      toUserId: "seller-1",
      status: "ACCEPTED",
    })

    const { GET } = await import("@/app/api/lines/[lineId]/offer/[offerId]/checkout/route")
    const req = new Request("http://localhost/api/lines/line-1/offer/offer-1/checkout")

    const response = await GET(req, {
      params: Promise.resolve({ lineId: "line-1", offerId: "offer-1" }),
    })
    expect(response.status).toBe(403)
  })
})

describe("POST /api/lines/[lineId]/fulfill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("refuses to fulfill a position that's locked in a pending swap", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-1",
      lineId: "line-1",
      fulfilled: false,
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000), // locked for 10 more minutes
      user: { id: "user-1", email: null, emailNotifications: false },
    })

    const { POST } = await import("@/app/api/lines/[lineId]/fulfill/route")
    const req = new Request("http://localhost/api/lines/line-1/fulfill", {
      method: "POST",
      body: JSON.stringify({ positionId: "pos-1" }),
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(409)

    const data = await response.json()
    expect(data.error).toMatch(/pending swap/i)
  })

  it("only marks purchases settled once their money was actually collected", async () => {
    // Regression: settledAt was stamped before capture, so a lapsed hold
    // still showed as "paid out" and vanished from the owner's queue.
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1", name: "L" })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      id: "pos-1", lineId: "line-1", userId: "buyer-1", fulfilled: false, lockedUntil: null,
      user: { id: "buyer-1", email: null, emailNotifications: false },
    })
    mockPrisma.linePosition.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.transaction.findMany.mockResolvedValue([
      { id: "t-ok", sellerId: "s1", amount: 10, ownerFee: 1, stripePaymentId: "cs_ok", lineId: "line-1" },
      { id: "t-lapsed", sellerId: "s2", amount: 10, ownerFee: 1, stripePaymentId: "cs_lapsed", lineId: "line-1" },
    ])
    const { releaseFunds } = await import("@/lib/stripe")
    vi.mocked(releaseFunds).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const { POST } = await import("@/app/api/lines/[lineId]/fulfill/route")
    const response = await POST(
      new Request("http://localhost/api/lines/line-1/fulfill", { method: "POST", body: JSON.stringify({ positionId: "pos-1" }) }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )
    const data = await response.json()

    expect(data).toMatchObject({ payoutsReleased: 1, payoutsFailed: 1 })
    expect(mockPrisma.transaction.update).toHaveBeenCalledTimes(1)
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "t-ok" },
      data: { settledAt: expect.any(Date) },
    })
  })
})

describe("POST /api/lines/[lineId]/settlement/action (cancel on PENDING)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStripeConfigured = true
  })

  it("cancels a stuck/unpaid checkout, unlocks positions, and expires the Stripe session", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: "txn-1",
      lineId: "line-1",
      status: "PENDING",
      settledAt: null,
      stripePaymentId: "cs_stuck",
    })
    const expire = vi.fn().mockResolvedValue(undefined)
    ;(mockStripe.checkout.sessions as unknown as { expire: typeof expire }).expire = expire

    const { POST } = await import("@/app/api/lines/[lineId]/settlement/action/route")
    const req = new Request("http://localhost/api/lines/line-1/settlement/action", {
      method: "POST",
      body: JSON.stringify({ transactionId: "txn-1", action: "cancel" }),
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(200)

    // abandonPendingTransaction unlocks, FAILs (only if still PENDING),
    // expires the session and reopens the offer -- see stripe-core tests.
    const { abandonPendingTransaction } = await import("@/lib/stripe")
    expect(abandonPendingTransaction).toHaveBeenCalledWith("txn-1")
  })

  it("rejects 'capture' on a PENDING transaction (nothing was ever authorized)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: "txn-1",
      lineId: "line-1",
      status: "PENDING",
      settledAt: null,
      stripePaymentId: "cs_stuck",
    })

    const { POST } = await import("@/app/api/lines/[lineId]/settlement/action/route")
    const req = new Request("http://localhost/api/lines/line-1/settlement/action", {
      method: "POST",
      body: JSON.stringify({ transactionId: "txn-1", action: "capture" }),
    })

    const response = await POST(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)
  })
})

describe("PATCH /api/lines/[lineId]/price", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects a $0 listing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })

    const { PATCH } = await import("@/app/api/lines/[lineId]/price/route")
    const req = new Request("http://localhost/api/lines/line-1/price", {
      method: "PATCH",
      body: JSON.stringify({ price: 0 }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data.error).toMatch(/at least \$1/)
  })

  it("refuses to re-price while a buyer is mid-checkout on this spot", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ allowResale: true, maxAskingPrice: null })
    mockPrisma.linePosition.findUnique.mockResolvedValue({
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    })

    const { PATCH } = await import("@/app/api/lines/[lineId]/price/route")
    const req = new Request("http://localhost/api/lines/line-1/price", {
      method: "PATCH",
      body: JSON.stringify({ price: 500 }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ lineId: "line-1" }) })
    expect(response.status).toBe(409)
    expect(mockPrisma.linePosition.update).not.toHaveBeenCalled()
  })

  it("still allows null (un-listing)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockPrisma.linePosition.findUnique.mockResolvedValue({ lockedUntil: null })
    mockPrisma.linePosition.update.mockResolvedValue({
      id: "pos-1",
      askingPrice: null,
      user: { id: "user-1", name: "User", image: null },
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
