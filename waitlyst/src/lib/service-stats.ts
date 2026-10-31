import type { VisitOutcome } from "@prisma/client"

interface Visit {
  outcome: VisitOutcome
  joinedAt: Date
  servedAt: Date | null
}

interface CurrentPosition {
  fulfilled: boolean
  joinedAt: Date
  fulfilledAt: Date | null
}

export interface ServiceStats {
  served: number
  left: number
  removed: number
  noShows: number
  waiting: number
  /** Median time from joining to being served */
  medianWaitMinutes: number | null
  servedLastHour: number
}

const HOUR_MS = 60 * 60 * 1000

/**
 * How the line has moved: everyone who has come through it, whether they're
 * still in it (served or waiting) or already gone (kept as a QueueVisit).
 */
export function serviceStats(visits: Visit[], positions: CurrentPosition[], now = new Date()): ServiceStats {
  const servedTimes: { joinedAt: Date; servedAt: Date }[] = []
  for (const v of visits) {
    if (v.outcome === "SERVED" && v.servedAt) servedTimes.push({ joinedAt: v.joinedAt, servedAt: v.servedAt })
  }
  for (const p of positions) {
    if (p.fulfilled && p.fulfilledAt) servedTimes.push({ joinedAt: p.joinedAt, servedAt: p.fulfilledAt })
  }

  const waits = servedTimes
    .map((s) => s.servedAt.getTime() - s.joinedAt.getTime())
    .sort((a, b) => a - b)
  let medianWaitMinutes: number | null = null
  if (waits.length > 0) {
    const mid = Math.floor(waits.length / 2)
    const medianMs = waits.length % 2 ? waits[mid] : (waits[mid - 1] + waits[mid]) / 2
    medianWaitMinutes = Math.round((medianMs / 60000) * 10) / 10
  }

  return {
    // Visits record SERVED for anyone served before leaving, so served
    // positions still in line are the only ones to add.
    served: visits.filter((v) => v.outcome === "SERVED").length + positions.filter((p) => p.fulfilled).length,
    left: visits.filter((v) => v.outcome === "LEFT").length,
    removed: visits.filter((v) => v.outcome === "REMOVED").length,
    noShows: visits.filter((v) => v.outcome === "NO_SHOW").length,
    waiting: positions.filter((p) => !p.fulfilled).length,
    medianWaitMinutes,
    servedLastHour: servedTimes.filter((s) => now.getTime() - s.servedAt.getTime() < HOUR_MS).length,
  }
}
