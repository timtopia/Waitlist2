import { describe, it, expect, vi, afterEach } from "vitest"

const getStripe = vi.fn()
vi.mock("@/lib/stripe", () => ({ getStripe: () => getStripe() }))

describe("paymentsUnavailable", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("refuses trades in production when there's no Stripe key", async () => {
    vi.stubEnv("NODE_ENV", "production")
    getStripe.mockReturnValue(null)
    const { paymentsUnavailable } = await import("@/lib/payments-mode")
    expect(paymentsUnavailable()).toBe(true)
  })

  it("allows the no-payment dev mode outside production, or when explicitly turned on", async () => {
    getStripe.mockReturnValue(null)
    const { paymentsUnavailable } = await import("@/lib/payments-mode")
    vi.stubEnv("NODE_ENV", "development")
    expect(paymentsUnavailable()).toBe(false)
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ALLOW_DEV_PAYMENTS", "true")
    expect(paymentsUnavailable()).toBe(false)
  })

  it("never blocks when Stripe is configured", async () => {
    vi.stubEnv("NODE_ENV", "production")
    getStripe.mockReturnValue({})
    const { paymentsUnavailable } = await import("@/lib/payments-mode")
    expect(paymentsUnavailable()).toBe(false)
  })
})
