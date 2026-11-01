import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Prisma
const mockPrisma = {
  linePosition: { updateMany: vi.fn() },
  transaction: { update: vi.fn(), findFirst: vi.fn() },
  $transaction: vi.fn(),
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

// Mock Stripe
const mockConstructEvent = vi.fn()
const mockPerformPositionSwap = vi.fn()
const mockSessionsList = vi.fn()
const mockGetStripe = vi.fn()

vi.mock("@/lib/stripe", () => ({
  getStripe: () => mockGetStripe(),
  performPositionSwap: (...args: unknown[]) => mockPerformPositionSwap(...args),
  abandonPendingTransaction: (...args: unknown[]) => mockAbandon(...args),
  isCheckoutAuthorized: (...args: unknown[]) => mockIsAuthorized(...args),
  recordPaymentIntent: (...args: unknown[]) => mockRecordPaymentIntent(...args),
}))
const mockAbandon = vi.fn()
const mockIsAuthorized = vi.fn()
const mockRecordPaymentIntent = vi.fn()

function makeStripeInstance() {
  return {
    webhooks: { constructEvent: mockConstructEvent },
    checkout: { sessions: { list: mockSessionsList } },
  }
}

function makeRequest(body: string, signature: string | null = "sig_test") {
  const headers = new Headers()
  if (signature) headers.set("stripe-signature", signature)
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
    headers,
  })
}

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")
    mockGetStripe.mockReturnValue(makeStripeInstance())
    mockIsAuthorized.mockResolvedValue(true)
  })

  it("should return 503 if Stripe is not configured", async () => {
    mockGetStripe.mockReturnValue(null)

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(503)
  })

  it("should return 500 if webhook secret is not set", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "")

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(500)
  })

  it("should return 400 if stripe-signature header is missing", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}", null))

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("Missing stripe-signature")
  })

  it("should return 400 if signature verification fails", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature")
    })

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("signature verification failed")
  })

  it("should handle checkout.session.completed and perform swap", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { transactionId: "txn-1", lineId: "line-1" },
        },
      },
    })
    mockPerformPositionSwap.mockResolvedValue(true)

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(200)
    expect(mockPerformPositionSwap).toHaveBeenCalledWith("txn-1")
    expect(mockRecordPaymentIntent).toHaveBeenCalledWith("txn-1", expect.objectContaining({ metadata: expect.any(Object) }))
  })

  it("does not swap when the completed session's payment isn't authorized", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_unpaid", metadata: { transactionId: "txn-1" } } },
    })
    mockIsAuthorized.mockResolvedValue(false)

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(200)
    expect(mockPerformPositionSwap).not.toHaveBeenCalled()
  })

  it("should handle checkout.session.completed with missing transactionId", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: { metadata: {} },
      },
    })

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(200)
    expect(mockPerformPositionSwap).not.toHaveBeenCalled()
  })

  it("should handle checkout.session.expired and clean up", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.expired",
      data: {
        object: { metadata: { transactionId: "txn-2", offerId: "offer-9" } },
      },
    })

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(200)
    // Abandons only-if-PENDING, unlocks, and hands the accepted offer back.
    // A timeout counts toward the buyer's abandon limit
    expect(mockAbandon).toHaveBeenCalledWith("txn-2", { offerId: "offer-9", expireSession: false, byBuyer: true })
  })

  it("should handle checkout.session.expired with no transactionId gracefully", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.expired",
      data: {
        object: { metadata: {} },
      },
    })

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(200)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it("should handle charge.refunded and update transaction status", async () => {
    mockConstructEvent.mockReturnValue({
      type: "charge.refunded",
      data: {
        object: { payment_intent: "pi_123", refunded: true },
      },
    })
    mockSessionsList.mockResolvedValue({
      data: [{ id: "cs_session_1" }],
    })
    mockPrisma.transaction.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "txn-3",
      status: "COMPLETED",
      stripePaymentId: "cs_session_1",
    })
    mockPrisma.transaction.update.mockResolvedValue({})

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(200)
    expect(mockSessionsList).toHaveBeenCalledWith({
      payment_intent: "pi_123",
      limit: 1,
    })
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "txn-3" },
      data: { status: "REFUNDED", settledAt: expect.any(Date) },
    })
  })

  it("finds the refunded purchase by its recorded PaymentIntent without asking Stripe", async () => {
    mockConstructEvent.mockReturnValue({
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_789", refunded: true } },
    })
    mockPrisma.transaction.findFirst.mockResolvedValue({ id: "txn-6", status: "COMPLETED" })
    mockPrisma.transaction.update.mockResolvedValue({})

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(200)
    expect(mockPrisma.transaction.findFirst).toHaveBeenCalledWith({ where: { stripePaymentIntentId: "pi_789" } })
    expect(mockSessionsList).not.toHaveBeenCalled()
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "txn-6" },
      data: { status: "REFUNDED", settledAt: expect.any(Date) },
    })
  })

  it("leaves the purchase alone on a partial refund", async () => {
    mockConstructEvent.mockReturnValue({
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_789", refunded: false } },
    })

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(200)
    expect(mockPrisma.transaction.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.transaction.update).not.toHaveBeenCalled()
  })

  it("should not update already-refunded transaction", async () => {
    mockConstructEvent.mockReturnValue({
      type: "charge.refunded",
      data: {
        object: { payment_intent: "pi_456", refunded: true },
      },
    })
    mockSessionsList.mockResolvedValue({
      data: [{ id: "cs_session_2" }],
    })
    mockPrisma.transaction.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "txn-4",
      status: "REFUNDED",
      stripePaymentId: "cs_session_2",
    })

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(200)
    expect(mockPrisma.transaction.update).not.toHaveBeenCalled()
  })

  it("marks an uncollected purchase when Stripe lets its hold lapse", async () => {
    mockConstructEvent.mockReturnValue({
      type: "payment_intent.canceled",
      data: { object: { id: "pi_exp", cancellation_reason: "automatic" } },
    })
    mockPrisma.transaction.findFirst.mockResolvedValue({ id: "txn-7", status: "COMPLETED", capturedAt: null })

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(200)
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "txn-7" },
      data: { status: "FAILED", holdExpiredAt: expect.any(Date), settledAt: expect.any(Date) },
    })
  })

  it("ignores cancellations the app made itself", async () => {
    mockConstructEvent.mockReturnValue({
      type: "payment_intent.canceled",
      data: { object: { id: "pi_rel", cancellation_reason: "requested_by_customer" } },
    })

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    await POST(makeRequest("{}"))

    expect(mockPrisma.transaction.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.transaction.update).not.toHaveBeenCalled()
  })

  it("leaves an already-collected purchase alone when a hold event arrives", async () => {
    mockConstructEvent.mockReturnValue({
      type: "payment_intent.canceled",
      data: { object: { id: "pi_cap", cancellation_reason: "automatic" } },
    })
    mockPrisma.transaction.findFirst.mockResolvedValue({ id: "txn-8", status: "COMPLETED", capturedAt: new Date() })

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    await POST(makeRequest("{}"))

    expect(mockPrisma.transaction.update).not.toHaveBeenCalled()
  })

  it("should return 200 for unhandled event types", async () => {
    mockConstructEvent.mockReturnValue({
      type: "some.unknown.event",
      data: { object: {} },
    })

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.received).toBe(true)
  })

  it("returns 500 when a handler throws so Stripe retries", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: { metadata: { transactionId: "txn-5", lineId: "line-1" } },
      },
    })
    mockPerformPositionSwap.mockRejectedValue(new Error("DB connection lost"))

    const { POST } = await import("@/app/api/webhooks/stripe/route")
    const response = await POST(makeRequest("{}"))

    expect(response.status).toBe(500)
  })
})
