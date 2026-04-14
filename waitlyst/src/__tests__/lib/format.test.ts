import { describe, it, expect, vi, afterEach } from "vitest"
import {
  timeAgo,
  formatTimeLeft,
  formatDropCountdown,
  formatDate,
  formatDateTime,
  formatCurrency,
} from "@/lib/format"

describe("timeAgo", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for less than 1 minute ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-06-15T12:00:30Z"))
    expect(timeAgo("2025-06-15T12:00:00Z")).toBe("just now")
  })

  it('returns "5m ago" for 5 minutes ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-06-15T12:05:00Z"))
    expect(timeAgo("2025-06-15T12:00:00Z")).toBe("5m ago")
  })

  it('returns "2h ago" for 2 hours ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-06-15T14:00:00Z"))
    expect(timeAgo("2025-06-15T12:00:00Z")).toBe("2h ago")
  })

  it('returns "3d ago" for 3 days ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-06-18T12:00:00Z"))
    expect(timeAgo("2025-06-15T12:00:00Z")).toBe("3d ago")
  })

  it("falls back to a formatted date for 7+ days ago", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-06-25T12:00:00Z"))
    const result = timeAgo("2025-06-15T12:00:00Z")
    // Should not contain "ago" — it should be a locale-formatted date like "Jun 15"
    expect(result).not.toContain("ago")
    expect(result).toContain("15")
  })
})

describe("formatTimeLeft", () => {
  it('returns "0s" for 0 ms', () => {
    expect(formatTimeLeft(0)).toBe("0s")
  })

  it('returns "0s" for negative ms', () => {
    expect(formatTimeLeft(-1000)).toBe("0s")
  })

  it("returns seconds only when under a minute", () => {
    expect(formatTimeLeft(45_000)).toBe("45s")
  })

  it("returns minutes and seconds", () => {
    // 3m 15s = 195_000 ms
    expect(formatTimeLeft(195_000)).toBe("3m 15s")
  })

  it("returns hours, minutes, and seconds", () => {
    // 2h 5m 30s
    const ms = 2 * 3600_000 + 5 * 60_000 + 30_000
    expect(formatTimeLeft(ms)).toBe("2h 5m 30s")
  })

  it("returns days, hours, and minutes (drops seconds)", () => {
    // 3d 4h 25m 10s — seconds are omitted at day scale
    const ms = 3 * 86400_000 + 4 * 3600_000 + 25 * 60_000 + 10_000
    expect(formatTimeLeft(ms)).toBe("3d 4h 25m")
  })
})

describe("formatDropCountdown", () => {
  it('returns "0:00" for 0 ms', () => {
    expect(formatDropCountdown(0)).toBe("0:00")
  })

  it('returns "0:00" for negative ms', () => {
    expect(formatDropCountdown(-5000)).toBe("0:00")
  })

  it('returns "0:45" for 45 seconds', () => {
    expect(formatDropCountdown(45_000)).toBe("0:45")
  })

  it('returns "15:30" for 15 minutes 30 seconds', () => {
    const ms = 15 * 60_000 + 30_000
    expect(formatDropCountdown(ms)).toBe("15:30")
  })

  it('returns "2:15:30" for 2 hours 15 minutes 30 seconds', () => {
    const ms = 2 * 3600_000 + 15 * 60_000 + 30_000
    expect(formatDropCountdown(ms)).toBe("2:15:30")
  })

  it("zero-pads minutes and seconds in hours format", () => {
    // 1:05:09
    const ms = 1 * 3600_000 + 5 * 60_000 + 9_000
    expect(formatDropCountdown(ms)).toBe("1:05:09")
  })
})

describe("formatDate", () => {
  it("returns a formatted date string", () => {
    const result = formatDate("2025-01-05T00:00:00Z")
    // Locale-dependent, but should contain the year and day
    expect(result).toContain("2025")
    expect(result).toContain("5")
    // Should include a short month name like "Jan"
    expect(result).toMatch(/Jan/)
  })
})

describe("formatDateTime", () => {
  it("returns a date + time string", () => {
    const result = formatDateTime("2025-01-05T14:30:00Z")
    // Should contain the day and a short month
    expect(result).toContain("5")
    expect(result).toMatch(/Jan/)
    // Should contain a time component (locale-dependent format)
    // The time portion should be present — check for a colon from the time
    expect(result).toMatch(/\d+:\d+/)
  })
})

describe("formatCurrency", () => {
  it('formats zero as "$0.00"', () => {
    expect(formatCurrency(0)).toBe("$0.00")
  })

  it('formats a whole number as "$25.00"', () => {
    expect(formatCurrency(25)).toBe("$25.00")
  })

  it("formats a decimal amount correctly", () => {
    expect(formatCurrency(1234.56)).toBe("$1234.56")
  })

  it("formats negative numbers", () => {
    expect(formatCurrency(-10)).toBe("$-10.00")
  })

  it("rounds to two decimal places", () => {
    expect(formatCurrency(9.999)).toBe("$10.00")
  })
})
