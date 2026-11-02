import { describe, it, expect } from "vitest"
import { estimateMinutesPerPerson, formatWaitTime } from "@/lib/wait-time"

const base = new Date("2025-06-01T12:00:00Z").getTime()
const at = (min: number) => new Date(base + min * 60000)

describe("estimateMinutesPerPerson", () => {
  it("needs at least two distinct service events", () => {
    expect(estimateMinutesPerPerson([])).toEqual({ minutes: null, basedOn: 0 })
    expect(estimateMinutesPerPerson([at(0), new Date(base + 3000)])).toEqual({ minutes: null, basedOn: 1 })
  })

  it("accepts timestamps in any order", () => {
    expect(estimateMinutesPerPerson([at(10), at(0), at(5)]).minutes).toBe(5)
  })

  it("uses the median so one long break doesn't inflate everyone's wait", () => {
    // 4 quick services, then a 60-minute lunch break, then 2 more quick ones
    const times = [at(0), at(2), at(4), at(6), at(66), at(68), at(70)]
    expect(estimateMinutesPerPerson(times).minutes).toBe(2)
  })

  it("only looks at the most recent pace", () => {
    // Slow at the start (10 min each), then 12 fast services (1 min each)
    const slow = [0, 10, 20, 30].map(at)
    const fast = Array.from({ length: 12 }, (_, i) => at(31 + i))
    expect(estimateMinutesPerPerson([...slow, ...fast]).minutes).toBe(1)
  })
})

describe("estimateMinutesPerPerson with a cut-off", () => {
  it("ignores service before the cut-off, like last night's sitting", () => {
    // Slow yesterday, two quick seatings today
    const yesterday = [0, 30, 60].map(at)
    const today = [24 * 60, 24 * 60 + 4].map(at)
    expect(estimateMinutesPerPerson([...yesterday, ...today]).minutes).toBe(30)
    expect(estimateMinutesPerPerson([...yesterday, ...today], at(23 * 60))).toEqual({ minutes: 4, basedOn: 2 })
    // Nothing tonight yet: no estimate rather than yesterday's
    expect(estimateMinutesPerPerson(yesterday, at(23 * 60))).toEqual({ minutes: null, basedOn: 0 })
  })
})

describe("formatWaitTime", () => {
  it("formats minutes and hours", () => {
    expect(formatWaitTime(0.4)).toBe("<1 min")
    expect(formatWaitTime(12.4)).toBe("~12 min")
    expect(formatWaitTime(90)).toBe("~1 hr")
    expect(formatWaitTime(200)).toBe("~3 hrs")
  })
})
