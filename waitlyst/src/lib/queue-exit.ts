import type { LinePosition, Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import { settleTransactionsForUser } from "./settle-transactions"
import { buyerTotal } from "./fees"
import { expireCheckoutSession, getBaseUrl, releaseAndSettle, returnBuyerFunds } from "./stripe"
import { runAfterResponse } from "./after-response"
import { sendEmail } from "./email"
import { removedFromLineEmail } from "./email-templates"

export class PositionNotFoundError extends Error {
  constructor() {
    super("Position not found")
  }
}

export interface RemovalResult {
  fulfilled: boolean
  /** Purchases given back to the buyer, and what the buyer was charged for them */
  refundedCount: number
  refundedAmount: number
  /** Refunds Stripe wouldn't do; those purchases are still open on the settlement page */
  refundFailedCount: number
  /** Held purchases collected and paid out instead */
  collectedCount: number
  collectFailedCount: number
}

/**
 * The organizer removes someone and decides what happens to purchases of
 * theirs that are still open (held on their card, not yet paid out):
 * - "payout": the trade stands, like when someone leaves. The people they
 *   bought from gave up their places, so the payment is collected now.
 * - "refund": the buyer gets the money back.
 * Purchases already paid out are final either way; nothing here undoes them.
 */
export async function removeByOrganizer(
  lineId: string,
  positionId: string,
  action: "payout" | "refund",
  /** Record it as a no-show rather than a plain removal */
  noShow = false
): Promise<RemovalResult> {
  const position = await prisma.linePosition.findUnique({ where: { id: positionId, lineId } })
  if (!position) throw new PositionNotFoundError()

  const openPurchases = await prisma.transaction.findMany({
    where: { lineId, buyerId: position.userId, status: "COMPLETED", settledAt: null },
  })

  let refundedIds: string[] = []
  if (action === "refund") refundedIds = await returnBuyerFunds(openPurchases)

  // Re-read inside the transaction: the queue may have shifted while the
  // refunds were going through.
  const { abandonedSessionId } = await prisma.$transaction(async (tx) => {
    const current = await tx.linePosition.findUnique({ where: { id: positionId, lineId } })
    if (!current) throw new PositionNotFoundError()
    return exitQueue(tx, current, noShow ? "NO_SHOW" : "REMOVED")
  })
  await expireCheckoutSession(abandonedSessionId)

  let collectedCount = 0
  if (action === "payout") {
    for (const purchase of openPurchases) {
      if (await releaseAndSettle(purchase)) collectedCount++
    }
  }

  const refunded = openPurchases.filter((p) => refundedIds.includes(p.id))

  // Someone removed while waiting would otherwise only find out if they had
  // the page open. Served people leaving the list don't need telling.
  if (!position.fulfilled) {
    runAfterResponse(async () => {
      const [user, line] = await Promise.all([
        prisma.user.findUnique({
          where: { id: position.userId },
          select: { name: true, email: true, emailNotifications: true },
        }),
        prisma.line.findUnique({ where: { id: lineId }, select: { name: true } }),
      ])
      if (!user?.email || !user.emailNotifications || !line) return
      const { subject, html } = removedFromLineEmail(
        user.name || "there",
        line.name,
        refunded.length > 0,
        `${getBaseUrl()}/lines/${lineId}`
      )
      await sendEmail(user.email, subject, html)
    })
  }

  return {
    fulfilled: position.fulfilled,
    refundedCount: refunded.length,
    refundedAmount: refunded.reduce((sum, p) => sum + buyerTotal(p), 0),
    refundFailedCount: action === "refund" ? openPurchases.length - refunded.length : 0,
    collectedCount,
    collectFailedCount: action === "payout" ? openPurchases.length - collectedCount : 0,
  }
}

/**
 * Serialize changes to a line's queue. Joins compute the next position from
 * the current maximum and exits shift everyone behind up a place; without a
 * shared lock two of these running at once can hand out the same position or
 * leave a gap.
 */
export async function lockLine(tx: Prisma.TransactionClient, lineId: string) {
  await tx.$queryRaw`SELECT id FROM "Line" WHERE id = ${lineId} FOR UPDATE`
}

/**
 * Take someone out of a line, however they're leaving. Every exit path
 * (leaving, the organizer removing them, clearing the front) goes through
 * here so they all record the visit, release any checkout the spot was
 * locked in, retire offers that pointed at it, and close up the gap.
 *
 * Returns the Stripe session of an abandoned checkout so the caller can
 * expire it after the database transaction commits.
 */
export async function exitQueue(
  tx: Prisma.TransactionClient,
  position: LinePosition,
  reason: "LEFT" | "REMOVED" | "NO_SHOW"
): Promise<{ abandonedSessionId: string | null }> {
  const { lineId, userId } = position
  await lockLine(tx, lineId)

  let abandonedSessionId: string | null = null
  let abandonedTransactionId: string | null = null
  if (position.lockedBy) {
    // Only a checkout that hasn't been paid can be abandoned; a completed one
    // has already moved the spots and must not be flipped to FAILED.
    const { count } = await tx.transaction.updateMany({
      where: { id: position.lockedBy, status: "PENDING" },
      data: { status: "FAILED" },
    })
    if (count > 0) {
      const abandoned = await tx.transaction.findUnique({
        where: { id: position.lockedBy },
        select: { stripePaymentId: true },
      })
      abandonedSessionId = abandoned?.stripePaymentId ?? null
      abandonedTransactionId = position.lockedBy
    }
    await tx.linePosition.updateMany({
      where: { lockedBy: position.lockedBy },
      data: { lockedUntil: null, lockedBy: null },
    })
  }

  await tx.queueVisit.create({
    data: {
      lineId,
      userId,
      outcome: position.fulfilled ? "SERVED" : reason,
      position: position.position,
      joinedAt: position.joinedAt,
      calledAt: position.calledAt,
      servedAt: position.fulfilledAt,
    },
  })

  await tx.linePosition.delete({ where: { id: position.id } })
  await tx.linePosition.updateMany({
    where: { lineId, position: { gt: position.position } },
    data: { position: { decrement: 1 } },
  })

  // The spot these offers referred to is gone. An accepted offer whose
  // checkout was just abandoned goes too, rather than reopening.
  await tx.swapOffer.updateMany({
    where: { lineId, status: "PENDING", OR: [{ fromUserId: userId }, { toUserId: userId }] },
    data: { status: "EXPIRED" },
  })
  if (abandonedTransactionId) {
    await tx.swapOffer.updateMany({
      where: { transactionId: abandonedTransactionId, status: "ACCEPTED" },
      data: { status: "EXPIRED" },
    })
  }

  await tx.line.updateMany({
    where: { id: lineId, nowServingUserId: userId },
    data: { nowServing: null, nowServingUserId: null, nowServingAt: null },
  })

  await settleTransactionsForUser(tx, lineId, userId)

  return { abandonedSessionId }
}
