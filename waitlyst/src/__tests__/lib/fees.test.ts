import { describe, it, expect, vi, beforeEach } from "vitest"

describe("getPlatformFeePercent", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("returns the default 10 when env var is not set", async () => {
    vi.stubEnv("PLATFORM_FEE_PERCENT", "")
    const { getPlatformFeePercent } = await import("@/lib/fees")
    expect(getPlatformFeePercent()).toBe(10)
  })

  it("respects the PLATFORM_FEE_PERCENT env var", async () => {
    vi.stubEnv("PLATFORM_FEE_PERCENT", "15")
    const { getPlatformFeePercent } = await import("@/lib/fees")
    expect(getPlatformFeePercent()).toBe(15)
  })
})

describe("calculateFees", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("calculates correct fees for a typical asking price", async () => {
    vi.stubEnv("PLATFORM_FEE_PERCENT", "10")
    const { calculateFees } = await import("@/lib/fees")

    const result = calculateFees(1000, 5)
    // ownerFee = Math.round(1000 * 5) / 100 = 50
    expect(result.ownerFee).toBe(50)
    // platformFee = Math.round(1000 * 10) / 100 = 100
    expect(result.platformFee).toBe(100)
    expect(result.askingPrice).toBe(1000)
    expect(result.ownerFeePercent).toBe(5)
    expect(result.platformFeePercent).toBe(10)
    expect(result.totalPrice).toBe(1150)
  })

  it("returns zero fees for a zero asking price", async () => {
    vi.stubEnv("PLATFORM_FEE_PERCENT", "10")
    const { calculateFees } = await import("@/lib/fees")

    const result = calculateFees(0, 5)
    expect(result.ownerFee).toBe(0)
    expect(result.platformFee).toBe(0)
    expect(result.totalPrice).toBe(0)
  })

  it("returns zero owner fee when owner fee percent is 0", async () => {
    vi.stubEnv("PLATFORM_FEE_PERCENT", "10")
    const { calculateFees } = await import("@/lib/fees")

    const result = calculateFees(500, 0)
    expect(result.ownerFee).toBe(0)
    // platformFee = Math.round(500 * 10) / 100 = 50
    expect(result.platformFee).toBe(50)
    expect(result.totalPrice).toBe(550)
  })

  it("handles fractional fee amounts via rounding", async () => {
    vi.stubEnv("PLATFORM_FEE_PERCENT", "7")
    const { calculateFees } = await import("@/lib/fees")

    const result = calculateFees(33, 3)
    // ownerFee = Math.round(33 * 3) / 100 = Math.round(99) / 100 = 0.99
    expect(result.ownerFee).toBe(0.99)
    // platformFee = Math.round(33 * 7) / 100 = Math.round(231) / 100 = 2.31
    expect(result.platformFee).toBe(2.31)
    expect(result.totalPrice).toBe(33 + 0.99 + 2.31)
  })
})

describe("calcFees", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("calculates fees matching calculateFees logic", async () => {
    const { calcFees } = await import("@/lib/fees")

    const result = calcFees(1000, 5, 10)
    expect(result.ownerFee).toBe(50)
    expect(result.platformFee).toBe(100)
    expect(result.total).toBe(1150)
  })

  it("returns early with zero fees when price is 0", async () => {
    const { calcFees } = await import("@/lib/fees")

    const result = calcFees(0, 5, 10)
    expect(result.ownerFee).toBe(0)
    expect(result.platformFee).toBe(0)
    expect(result.total).toBe(0)
  })

  it("handles zero fee percents", async () => {
    const { calcFees } = await import("@/lib/fees")

    const result = calcFees(200, 0, 0)
    expect(result.ownerFee).toBe(0)
    expect(result.platformFee).toBe(0)
    expect(result.total).toBe(200)
  })

  it("handles fractional fee amounts via rounding", async () => {
    const { calcFees } = await import("@/lib/fees")

    const result = calcFees(33, 3, 7)
    expect(result.ownerFee).toBe(0.99)
    expect(result.platformFee).toBe(2.31)
    expect(result.total).toBe(33 + 0.99 + 2.31)
  })
})
