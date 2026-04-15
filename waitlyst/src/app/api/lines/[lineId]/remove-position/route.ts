import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { refundTransactions, cancelAuthorization } from "@/lib/stripe"
import { settleTransactionsForUser } from "@/lib/settle-transactions"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const { positionId, action = "payout" } = await req.json()

  if (!positionId || typeof positionId !== "string") {
    return NextResponse.json({ error: "Position ID is required" }, { status: 400 })
  }

  if (!["payout", "refund"].includes(action)) {
    return NextResponse.json({ error: "Action must be 'payout' or 'refund'" }, { status: 400 })
  }

  const authResult = await requireLineOwner(lineId)
  if (authResult instanceof NextResponse) return authResult

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
        // Mark the transaction as failed (will be refunded when buyer returns)
        await tx.transaction.update({
          where: { id: positionToRemove.lockedBy },
          data: { status: "FAILED" },
        })

        // Unlock any other positions locked by the same transaction
        await tx.linePosition.updateMany({
          where: { lockedBy: positionToRemove.lockedBy },
          data: { lockedUntil: null, lockedBy: null },
        })
      }

      // Determine if we need to refund buyer transactions.
      // If the position is NOT fulfilled and there are unsettled buyer transactions,
      // those should be refunded (the swap payments go back since the buyer never received the item).
      // If the position IS fulfilled, swap payments were already released via the fulfill endpoint.
      const shouldRefundBuyer = action === "refund" || !positionToRemove.fulfilled
      let purchasesToRefund: { id: string; stripePaymentId: string | null; amount: number }[] = []

      if (shouldRefundBuyer) {
        // Get unsettled completed transactions where this user was the buyer.
        // Already-settled transactions represent finalized swaps and should not be refunded.
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
        // Return transactions that need Stripe refunds (done outside transaction)
        return {
          userId,
          positionToRemove,
          purchasesToRefund,
          fulfilled: positionToRemove.fulfilled,
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

      return { userId, positionToRemove, purchasesToRefund: [], fulfilled: positionToRemove.fulfilled }
    })

    // Cancel authorizations or refund.
    // With auth-then-capture, uncaptured payments can be cancelled (no fees).
    // Already-captured payments fall back to a standard refund.
    let refundedAmount = 0
    let refundedCount = 0

    if (result.purchasesToRefund.length > 0) {
      const needsRefund: typeof result.purchasesToRefund = []

      for (const purchase of result.purchasesToRefund) {
        if (purchase.stripePaymentId) {
          const cancelled = await cancelAuthorization(purchase.stripePaymentId)
          if (cancelled) {
            // Authorization cancelled — mark as refunded in DB
            await prisma.transaction.update({
              where: { id: purchase.id },
              data: { status: "REFUNDED" },
            })
            refundedCount++
            refundedAmount += purchase.amount
            continue
          }
        }
        // Could not cancel (already captured or no Stripe ID) — needs a real refund
        needsRefund.push(purchase)
      }

      if (needsRefund.length > 0) {
        const refunded = await refundTransactions(needsRefund)
        refundedCount += refunded
        refundedAmount += needsRefund.reduce((sum, p) => sum + p.amount, 0)
      }

      // Now delete the position after cancellations/refunds are processed
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

        // Settle any transactions where both parties have now left
        await settleTransactionsForUser(tx, lineId, result.userId)
      })
    }

    return NextResponse.json({
      success: true,
      action,
      fulfilled: result.fulfilled,
      refundedAmount,
      refundedCount,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "Position not found") {
      return NextResponse.json(
        { error: "Could not find this person. They may have already left the line." },
        { status: 404 }
      )
    }
    console.error("Remove position error:", error)
    return NextResponse.json(
      { error: "Could not remove this person. Please try again." },
      { status: 500 }
    )
  }
}
