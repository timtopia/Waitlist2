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
  /** The same, over people served in the last few hours: tonight's pace, not a slow Tuesday's */
  recentMedianWaitMinutes: number | null
  servedLastHour: number
}

const HOUR_MS = 60 * 60 * 1000
const RECENT_MS = 3 * HOUR_MS

function medianMinutes(waitsMs: number[]): number | null {
  if (waitsMs.length === 0) return null
  const sorted = [...waitsMs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianMs = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round((medianMs / 60000) * 10) / 10
}

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

  const wait = (s: { joinedAt: Date; servedAt: Date }) => s.servedAt.getTime() - s.joinedAt.getTime()
  const medianWaitMinutes = medianMinutes(servedTimes.map(wait))
  const recentMedianWaitMinutes = medianMinutes(
    servedTimes.filter((s) => now.getTime() - s.servedAt.getTime() < RECENT_MS).map(wait)
  )

  return {
    // Visits record SERVED for anyone served before leaving, so served
    // positions still in line are the only ones to add.
    served: visits.filter((v) => v.outcome === "SERVED").length + positions.filter((p) => p.fulfilled).length,
    left: visits.filter((v) => v.outcome === "LEFT").length,
    removed: visits.filter((v) => v.outcome === "REMOVED").length,
    noShows: visits.filter((v) => v.outcome === "NO_SHOW").length,
    waiting: positions.filter((p) => !p.fulfilled).length,
    medianWaitMinutes,
    recentMedianWaitMinutes,
    servedLastHour: servedTimes.filter((s) => now.getTime() - s.servedAt.getTime() < HOUR_MS).length,
  }
}
