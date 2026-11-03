import type { LinePosition, Prisma, Transaction } from "@prisma/client"
import { prisma } from "./prisma"
import { settleTransactionsForUser } from "./settle-transactions"
import { buyerTotal } from "./fees"
import { expireCheckoutSession, getBaseUrl, releaseAndSettle, returnBuyerFunds } from "./stripe"
import { runAfterResponse } from "./after-response"
import { sendEmail } from "./email"
import { buyerRefundedEmail, removedFromLineEmail, saleReversedEmail } from "./email-templates"
import { servingLabel } from "./privacy"

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
  noShow = false,
  /** Skipped automatically for not showing up in time (changes the email) */
  missedCall = false,
  /** Cleared because the host closed the line (changes the email) */
  closing = false,
  /**
   * Re-checked on the row under the line lock; returning false aborts as if
   * they'd already gone. The no-show sweep uses it so a party the host just
   * seated, re-called or gave more time isn't removed from a stale read.
   */
  stillApplies?: (current: LinePosition) => boolean
): Promise<RemovalResult> {
  const position = await prisma.linePosition.findUnique({ where: { id: positionId, lineId } })
  if (!position) throw new PositionNotFoundError()

  const openPurchases = await prisma.transaction.findMany({
    where: { lineId, buyerId: position.userId, status: "COMPLETED", settledAt: null },
  })

  let refundedIds: string[] = []
  if (action === "refund") refundedIds = await returnBuyerFunds(openPurchases)

  // Re-read under the line lock: the queue may have shifted while the
  // refunds were going through, or another exit may be closing a gap ahead.
  const { abandonedSessionId } = await prisma.$transaction(async (tx) => {
    await lockLine(tx, lineId)
    const current = await tx.linePosition.findUnique({ where: { id: positionId, lineId } })
    if (!current || (stillApplies && !stillApplies(current))) throw new PositionNotFoundError()
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
  const refundedAmount = refunded.reduce((sum, p) => sum + buyerTotal(p), 0)
  const refundFailed = action === "refund" && refunded.length < openPurchases.length
  notifySaleReversed(refunded, lineId)

  // Someone removed while waiting would otherwise only find out if they had
  // the page open. Served people leaving the list don't need telling.
  if (!position.fulfilled) {
    runAfterResponse(async () => {
      const [user, line] = await Promise.all([
        prisma.user.findUnique({
          where: { id: position.userId },
          select: { name: true, email: true, emailNotifications: true },
        }),
        prisma.line.findUnique({ where: { id: lineId }, select: { name: true, kind: true } }),
      ])
      if (!user?.email || !user.emailNotifications || !line) return
      const { subject, html } = removedFromLineEmail(
        user.name || "there",
        line.name,
        refunded.length > 0,
        `${getBaseUrl()}/lines/${lineId}`,
        // A host-marked no-show was called and didn't come, same as a timeout
        missedCall || noShow ? "missed" : closing ? "closed" : "removed",
        collectedCount > 0,
        line.kind === "RESTAURANT",
        { refundedAmount, refundFailed }
      )
      await sendEmail(user.email, subject, html)
    })
  }

  return {
    fulfilled: position.fulfilled,
    refundedCount: refunded.length,
    refundedAmount,
    refundFailedCount: action === "refund" ? openPurchases.length - refunded.length : 0,
    collectedCount,
    collectFailedCount: action === "payout" ? openPurchases.length - collectedCount : 0,
  }
}

/**
 * Tell each seller whose sale was just refunded to the buyer: they were
 * promised a payout that now isn't coming. Sent after the response.
 */
export function notifySaleReversed(purchases: Pick<Transaction, "sellerId" | "amount">[], lineId: string) {
  if (purchases.length === 0) return
  runAfterResponse(async () => {
    const [line, sellers] = await Promise.all([
      prisma.line.findUnique({ where: { id: lineId }, select: { name: true, kind: true } }),
      prisma.user.findMany({
        where: { id: { in: purchases.map((p) => p.sellerId) } },
        select: { id: true, name: true, email: true, emailNotifications: true },
      }),
    ])
    if (!line) return
    const byId = new Map(sellers.map((s) => [s.id, s]))
    for (const p of purchases) {
      const seller = byId.get(p.sellerId)
      if (!seller?.email || !seller.emailNotifications) continue
      const { subject, html } = saleReversedEmail(
        seller.name || "there",
        line.name,
        p.amount,
        `${getBaseUrl()}/lines/${lineId}`,
        line.kind === "RESTAURANT"
      )
      await sendEmail(seller.email, subject, html)
    }
  })
}

/**
 * Tell each buyer whose payment the organizer returned from the settlement
 * page. (Buyers removed from the line hear about it in their removal email.)
 */
export function notifyBuyerRefunded(
  purchases: Pick<Transaction, "buyerId" | "amount" | "ownerFee" | "platformFee">[],
  lineId: string
) {
  if (purchases.length === 0) return
  runAfterResponse(async () => {
    const [line, buyers] = await Promise.all([
      prisma.line.findUnique({ where: { id: lineId }, select: { name: true, kind: true } }),
      prisma.user.findMany({
        where: { id: { in: purchases.map((p) => p.buyerId) } },
        select: { id: true, name: true, email: true, emailNotifications: true },
      }),
    ])
    if (!line) return
    const byId = new Map(buyers.map((b) => [b.id, b]))
    for (const p of purchases) {
      const buyer = byId.get(p.buyerId)
      if (!buyer?.email || !buyer.emailNotifications) continue
      const { subject, html } = buyerRefundedEmail(
        buyer.name || "there",
        line.name,
        buyerTotal(p),
        `${getBaseUrl()}/lines/${lineId}`,
        line.kind === "RESTAURANT"
      )
      await sendEmail(buyer.email, subject, html)
    }
  })
}

/**
 * Serialize changes to a line's queue. Joins compute the next position from
 * the current maximum and exits shift everyone behind up a place; without a
 * shared lock two of these running at once can hand out the same position or
 * leave a gap.
 */
/**
 * The party shown as "Now serving" was seated or left. If the host called
 * someone else out of order who's still on their way, show them instead:
 * clearing the banner outright hid it from every guest while a party was
 * still called.
 */
export async function clearNowServing(tx: Prisma.TransactionClient, lineId: string, userId: string) {
  const cleared = await tx.line.updateMany({
    where: { id: lineId, nowServingUserId: userId },
    data: { nowServing: null, nowServingUserId: null, nowServingAt: null },
  })
  if (!cleared?.count) return
  const stillCalled = await tx.linePosition.findFirst({
    where: { lineId, fulfilled: false, calledAt: { not: null }, userId: { not: userId } },
    orderBy: { calledAt: "desc" },
    include: { user: { select: { name: true } }, line: { select: { kind: true } } },
  })
  if (!stillCalled?.calledAt) return
  await tx.line.update({
    where: { id: lineId },
    data: {
      nowServing: servingLabel(stillCalled.line.kind, stillCalled.user?.name, stillCalled.partySize),
      nowServingUserId: stillCalled.userId,
      nowServingAt: stillCalled.calledAt,
    },
  })
}

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
      partySize: position.partySize,
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

  await clearNowServing(tx, lineId, userId)

  await settleTransactionsForUser(tx, lineId, userId)

  return { abandonedSessionId }
}
