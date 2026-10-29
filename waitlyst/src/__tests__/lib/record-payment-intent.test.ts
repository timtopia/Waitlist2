import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = { transaction: { update: vi.fn() } }
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))

const fakeStripe = { paymentIntents: { retrieve: vi.fn() } }
vi.mock("stripe", () => ({
  default: vi.fn(function () {
    return fakeStripe
  }),
}))
process.env.STRIPE_SECRET_KEY = "sk_test_fake"

const session = { payment_intent: "pi_1" } as never

describe("recordPaymentIntent", () => {
  beforeEach(() => vi.clearAllMocks())

  it("stores the PaymentIntent and the card hold's capture deadline", async () => {
    fakeStripe.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { payment_method_details: { card: { capture_before: 1_800_000_000 } } },
    })
    const { recordPaymentIntent } = await import("@/lib/stripe")
    await recordPaymentIntent("txn-1", session)

    expect(fakeStripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_1", { expand: ["latest_charge"] })
    expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "txn-1" },
      data: { stripePaymentIntentId: "pi_1", captureBefore: new Date(1_800_000_000 * 1000) },
    })
  })

  it("still stores the PaymentIntent when the deadline can't be read", async () => {
    fakeStripe.paymentIntents.retrieve.mockRejectedValue(new Error("network"))
    const { recordPaymentIntent } = await import("@/lib/stripe")
    await recordPaymentIntent("txn-1", session)

    expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "txn-1" },
      data: { stripePaymentIntentId: "pi_1" },
    })
  })
})
