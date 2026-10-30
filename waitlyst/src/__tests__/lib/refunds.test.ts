import { describe, it, expect, vi, beforeEach } from "vitest"

// A purchase is only recorded as REFUNDED once its money has really gone back
// to the buyer (or was never taken). These run the real helpers against a
// fake Stripe client.

const mockPrisma = {
  transaction: { update: vi.fn() },
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))

const fakeStripe = {
  checkout: { sessions: { retrieve: vi.fn() } },
  paymentIntents: { retrieve: vi.fn(), cancel: vi.fn() },
  refunds: { create: vi.fn() },
}
vi.mock("stripe", () => ({ default: vi.fn(function () { return fakeStripe }) }))

vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake")

const purchase = { id: "txn-1", stripePaymentId: "cs_1" }

describe("refundTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeStripe.checkout.sessions.retrieve.mockResolvedValue({ payment_intent: "pi_1" })
  })

  it("marks a purchase REFUNDED once Stripe refunds it", async () => {
    fakeStripe.refunds.create.mockResolvedValue({ id: "re_1" })
    const { refundTransactions } = await import("@/lib/stripe")

    expect(await refundTransactions([purchase])).toEqual(["txn-1"])
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "txn-1" },
      data: { status: "REFUNDED" },
    })
  })

  it("leaves the purchase alone when Stripe rejects the refund", async () => {
    fakeStripe.refunds.create.mockRejectedValue(Object.assign(new Error("card_declined"), { code: "balance_insufficient" }))
    const { refundTransactions } = await import("@/lib/stripe")

    expect(await refundTransactions([purchase])).toEqual([])
    expect(mockPrisma.transaction.update).not.toHaveBeenCalled()
  })

  it("treats an already-refunded charge as refunded", async () => {
    fakeStripe.refunds.create.mockRejectedValue(Object.assign(new Error("already"), { code: "charge_already_refunded" }))
    const { refundTransactions } = await import("@/lib/stripe")

    expect(await refundTransactions([purchase])).toEqual(["txn-1"])
    expect(mockPrisma.transaction.update).toHaveBeenCalled()
  })
})

describe("returnBuyerFunds", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeStripe.checkout.sessions.retrieve.mockResolvedValue({ payment_intent: "pi_1" })
  })

  it("releases a hold that was never collected, without a refund", async () => {
    fakeStripe.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "requires_capture" })
    const { returnBuyerFunds } = await import("@/lib/stripe")

    expect(await returnBuyerFunds([purchase])).toEqual(["txn-1"])
    expect(fakeStripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_1")
    expect(fakeStripe.refunds.create).not.toHaveBeenCalled()
  })

  it("refunds a payment that was already collected", async () => {
    fakeStripe.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" })
    fakeStripe.refunds.create.mockResolvedValue({ id: "re_1" })
    const { returnBuyerFunds } = await import("@/lib/stripe")

    expect(await returnBuyerFunds([purchase])).toEqual(["txn-1"])
    expect(fakeStripe.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_1" })
  })

  it("reports nothing returned when the release and the refund both fail", async () => {
    fakeStripe.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" })
    fakeStripe.refunds.create.mockRejectedValue(new Error("Stripe is down"))
    const { returnBuyerFunds } = await import("@/lib/stripe")

    expect(await returnBuyerFunds([purchase])).toEqual([])
    expect(mockPrisma.transaction.update).not.toHaveBeenCalled()
  })
})
