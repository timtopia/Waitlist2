import { describe, it, expect } from "vitest"
import { serviceStats } from "@/lib/service-stats"

const now = new Date("2026-10-29T12:00:00Z")
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60000)

describe("serviceStats", () => {
  it("counts outcomes across people still in line and people gone", () => {
    const stats = serviceStats(
      [
        { outcome: "SERVED", joinedAt: at(120), servedAt: at(100) }, // waited 20
        { outcome: "LEFT", joinedAt: at(90), servedAt: null },
        { outcome: "REMOVED", joinedAt: at(80), servedAt: null },
      ],
      [
        { fulfilled: true, joinedAt: at(50), fulfilledAt: at(40) }, // waited 10
        { fulfilled: true, joinedAt: at(60), fulfilledAt: at(30) }, // waited 30
        { fulfilled: false, joinedAt: at(20), fulfilledAt: null },
      ],
      now
    )
    expect(stats).toEqual({
      served: 3,
      left: 1,
      removed: 1,
      noShows: 0,
      waiting: 1,
      medianWaitMinutes: 20,
      servedLastHour: 2,
    })
  })

  it("has no median wait before anyone is served", () => {
    expect(serviceStats([], [{ fulfilled: false, joinedAt: at(5), fulfilledAt: null }], now)).toMatchObject({
      served: 0,
      waiting: 1,
      medianWaitMinutes: null,
    })
  })
})
