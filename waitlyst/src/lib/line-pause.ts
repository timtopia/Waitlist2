import { prisma } from "./prisma"

/**
 * Pause or resume a line. A pause stops the response-window clock for
 * everyone who's been called: on resume their call (and any "on my way") is
 * moved forward by the time spent paused, so nobody is skipped as a no-show
 * for minutes the host had the line stopped. Someone called during the pause
 * starts their window at the resume.
 */
export async function setLineActive(lineId: string, isActive: boolean, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const line = await tx.line.findUnique({ where: { id: lineId }, select: { isActive: true, pausedAt: true, nowServingAt: true } })
    if (!line || line.isActive === isActive) return line

    if (!isActive) {
      await tx.line.update({ where: { id: lineId }, data: { isActive: false, pausedAt: now } })
      return { isActive: false, pausedAt: now }
    }

    let resumedServingAt: Date | undefined
    if (line.pausedAt) {
      const pausedAt = line.pausedAt.getTime()
      const resumed = (t: Date) => new Date(t.getTime() + now.getTime() - Math.max(t.getTime(), pausedAt))
      // "Called 5 min ago" on the line page counts from nowServingAt; keep it
      // in step with the call it describes, or it reads 20 min more than the
      // host's console and the guest's timer after a long pause
      if (line.nowServingAt) {
        resumedServingAt = resumed(line.nowServingAt)
      }
      const called = await tx.linePosition.findMany({
        where: { lineId, fulfilled: false, calledAt: { not: null } },
        select: { id: true, calledAt: true, respondedAt: true },
      })
      for (const p of called) {
        await tx.linePosition.update({
          where: { id: p.id },
          data: { calledAt: resumed(p.calledAt!), respondedAt: p.respondedAt ? resumed(p.respondedAt) : null },
        })
      }
    }
    await tx.line.update({
      where: { id: lineId },
      data: { isActive: true, pausedAt: null, ...(resumedServingAt && { nowServingAt: resumedServingAt }) },
    })
    return { isActive: true, pausedAt: null }
  })
}
