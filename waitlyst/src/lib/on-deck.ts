import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { youreNextEmail } from "@/lib/email-templates"
import { getBaseUrl } from "@/lib/stripe"
import { runAfterResponse } from "@/lib/after-response"

/**
 * An uncalled party at the front just went (left, or seated without a call):
 * whoever is now first among the uncalled is next, and their card says so.
 * Email them the same heads-up a call would have sent, so a guest who relies
 * on email doesn't jump straight from silence to "your table is ready".
 *
 * `position` is where the departed row stood. After a leave, everyone behind
 * has moved up into it, so the search starts at it; after a seat the row is
 * still there, so it starts just behind.
 */
export async function emailNewlyOnDeck(
  lineId: string,
  departed: { position: number; calledAt: Date | null; fulfilled: boolean },
  rowRemains: boolean
): Promise<void> {
  // Called already: the call that preceded this sent the heads-up
  if (departed.calledAt) return
  try {
    const uncalledAhead = await prisma.linePosition.count({
      where: { lineId, fulfilled: false, calledAt: null, position: { lt: departed.position } },
    })
    if (uncalledAhead > 0) return
    const onDeck = await prisma.linePosition.findFirst({
      where: {
        lineId,
        fulfilled: false,
        calledAt: null,
        position: rowRemains ? { gt: departed.position } : { gte: departed.position },
      },
      orderBy: { position: "asc" },
      include: { user: { select: { name: true, email: true, emailNotifications: true } } },
    })
    if (!onDeck?.user?.email || !onDeck.user.emailNotifications) return
    const line = await prisma.line.findUnique({ where: { id: lineId }, select: { name: true, kind: true } })
    if (!line) return
    const { subject, html } = youreNextEmail(
      onDeck.user.name || "there",
      line.name,
      `${getBaseUrl()}/lines/${lineId}`,
      line.kind === "RESTAURANT"
    )
    const to = onDeck.user.email
    runAfterResponse(() => sendEmail(to, subject, html))
  } catch (error) {
    // A missed heads-up shouldn't fail the leave or seat that triggered it
    console.error("On-deck email error:", error)
  }
}
