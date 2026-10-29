import type { LinePosition, Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import { settleTransactionsForUser } from "./settle-transactions"
import { expireCheckoutSession, returnBuyerFunds } from "./stripe"

export class PositionNotFoundError extends Error {
  constructor() {
    super("Position not found")
  }
}

/**
 * The organizer removes someone. Unless they were served (and the action
 * isn't an explicit refund), their unsettled purchases are returned first --
 * they never got what they paid to move up for.
 */
export async function removeByOrganizer(
  lineId: string,
  positionId: string,
  action: "payout" | "refund"
): Promise<{ fulfilled: boolean; refundedCount: number; refundedAmount: number }> {
  const position = await prisma.linePosition.findUnique({ where: { id: positionId, lineId } })
  if (!position) throw new PositionNotFoundError()

  const purchasesToRefund = action === "refund" || !position.fulfilled
    ? await prisma.transaction.findMany({
        where: { lineId, buyerId: position.userId, status: "COMPLETED", settledAt: null },
      })
    : []
  const refundedCount = await returnBuyerFunds(purchasesToRefund)
  const refundedAmount = purchasesToRefund.reduce((sum, p) => sum + p.amount, 0)

  // Re-read inside the transaction: the queue may have shifted while the
  // refunds were going through.
  const { abandonedSessionId } = await prisma.$transaction(async (tx) => {
    const current = await tx.linePosition.findUnique({ where: { id: positionId, lineId } })
    if (!current) throw new PositionNotFoundError()
    return exitQueue(tx, current, "REMOVED")
  })
  await expireCheckoutSession(abandonedSessionId)

  return { fulfilled: position.fulfilled, refundedCount, refundedAmount }
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
  reason: "LEFT" | "REMOVED"
): Promise<{ abandonedSessionId: string | null }> {
  const { lineId, userId } = position

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
