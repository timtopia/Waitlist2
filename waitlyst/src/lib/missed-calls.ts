import { prisma } from "./prisma"
import { PositionNotFoundError, removeByOrganizer } from "./queue-exit"

/**
 * When a called person must show up by. Saying "on my way" buys one more
 * window from when they said it; "running late" doesn't.
 */
export function responseDeadline(
  calledAt: Date,
  windowMinutes: number,
  response: "ON_MY_WAY" | "RUNNING_LATE" | null,
  respondedAt: Date | null
): Date {
  const windowMs = windowMinutes * 60_000
  let deadline = calledAt.getTime() + windowMs
  if (response === "ON_MY_WAY" && respondedAt) deadline = Math.max(deadline, respondedAt.getTime() + windowMs)
  return new Date(deadline)
}

/**
 * Skip everyone on this line whose time to show up has run out: they're
 * removed as no-shows (purchases kept, as when someone leaves) and emailed.
 * Runs whenever the line is viewed, so a drop keeps moving without the owner
 * chasing each no-show. Returns how many were skipped.
 */
export async function expireMissedCalls(lineId: string, windowMinutes: number, now = new Date()): Promise<number> {
  const called = await prisma.linePosition.findMany({
    where: {
      lineId,
      fulfilled: false,
      calledAt: { not: null, lt: new Date(now.getTime() - windowMinutes * 60_000) },
    },
    select: { id: true, calledAt: true, response: true, respondedAt: true },
  })

  let skipped = 0
  for (const p of called) {
    if (responseDeadline(p.calledAt!, windowMinutes, p.response, p.respondedAt) > now) continue
    try {
      await removeByOrganizer(lineId, p.id, "payout", true, true)
      skipped++
    } catch (error) {
      // Another request skipped them first, or they left
      if (!(error instanceof PositionNotFoundError)) throw error
    }
  }
  return skipped
}
