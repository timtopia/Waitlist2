import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { refundTransactions } from "@/lib/stripe"
import { settleTransactionsForUser } from "@/lib/settle-transactions"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const { positionIds, action = "payout" } = await req.json()

  if (!Array.isArray(positionIds) || positionIds.length === 0) {
    return NextResponse.json(
      { error: "positionIds must be a non-empty array" },
      { status: 400 }
    )
  }

  if (!["payout", "refund"].includes(action)) {
    return NextResponse.json(
      { error: "Action must be 'payout' or 'refund'" },
      { status: 400 }
    )
  }

  const authResult = await requireLineOwner(lineId)
  if (authResult instanceof NextResponse) return authResult

  let removed = 0
  let failed = 0

  for (const positionId of positionIds) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Get the position to remove
        const positionToRemove = await tx.linePosition.findUnique({
          where: { id: positionId, lineId },
          include: { user: true },
        })
        if (!positionToRemove) {
          throw new Error("Position not found")
        }

        const userId = positionToRemove.userId

        // If position is locked in a transaction, cancel that transaction
        if (positionToRemove.lockedBy) {
          await tx.transaction.update({
            where: { id: positionToRemove.lockedBy },
            data: { status: "FAILED" },
          })

          await tx.linePosition.updateMany({
            where: { lockedBy: positionToRemove.lockedBy },
            data: { lockedUntil: null, lockedBy: null },
          })
        }

        // Determine if we need to refund buyer transactions.
        // If the position is NOT fulfilled, swap payments should be refunded
        // since the buyer never received the item.
        const shouldRefundBuyer = action === "refund" || !positionToRemove.fulfilled

        let purchasesToRefund: { id: string; stripePaymentId: string | null; amount: number }[] = []
        if (shouldRefundBuyer) {
          purchasesToRefund = await tx.transaction.findMany({
            where: {
              lineId,
              buyerId: userId,
              status: "COMPLETED",
              settledAt: null,
            },
          })
        }

        if (purchasesToRefund.length > 0) {
          return {
            userId,
            positionToRemove,
            purchasesToRefund,
          }
        }

        // Delete the position
        await tx.linePosition.delete({
          where: { id: positionId },
        })

        // Shift everyone behind up by one
        await tx.linePosition.updateMany({
          where: {
            lineId,
            position: { gt: positionToRemove.position },
          },
          data: {
            position: { decrement: 1 },
          },
        })

        // Settle any transactions where both parties have now left
        await settleTransactionsForUser(tx, lineId, userId)

        return { userId, positionToRemove, purchasesToRefund: [] }
      })

      // Process refunds outside the transaction (Stripe calls)
      if (result.purchasesToRefund.length > 0) {
        await refundTransactions(result.purchasesToRefund)

        // Now delete the position after refunds are processed
        await prisma.$transaction(async (tx) => {
          await tx.linePosition.delete({
            where: { id: positionId },
          })

          await tx.linePosition.updateMany({
            where: {
              lineId,
              position: { gt: result.positionToRemove.position },
            },
            data: {
              position: { decrement: 1 },
            },
          })

          await settleTransactionsForUser(tx, lineId, result.userId)
        })
      }

      removed++
    } catch {
      failed++
    }
  }

  return NextResponse.json({ removed, failed })
}
