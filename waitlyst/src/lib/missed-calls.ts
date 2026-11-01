import { prisma } from "./prisma"
import { PositionNotFoundError, removeByOrganizer } from "./queue-exit"

/**
 * When a called person must show up by. Saying "on my way" buys one more
 * window from when they first said it (respondedAt), and keeps it even if
 * they later say they're running late. "Running late" alone doesn't.
 */
export function responseDeadline(
  calledAt: Date,
  windowMinutes: number,
  respondedAt: Date | null
): Date {
  const windowMs = windowMinutes * 60_000
  let deadline = calledAt.getTime() + windowMs
  if (respondedAt) deadline = Math.max(deadline, respondedAt.getTime() + windowMs)
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
      // Walk-ins were added by the host at the stand and have no way to say
      // "on my way"; the host deals with them in person.
      user: { isWalkIn: false },
      // A paused line is stopped on purpose; nobody runs out of time
      line: { isActive: true },
    },
    select: { id: true, calledAt: true, respondedAt: true },
  })

  let skipped = 0
  for (const p of called) {
    if (responseDeadline(p.calledAt!, windowMinutes, p.respondedAt) > now) continue
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
