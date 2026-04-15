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

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
    let removedUserName = "Someone"
    let refundedCount = 0
    let refundedAmount = 0

    // First pass: get position info and collect transactions to refund (if unfulfilled)
    const txResult = await prisma.$transaction(async (tx) => {
      // Get the front position
      const frontPosition = await tx.linePosition.findFirst({
        where: { lineId, position: 1 },
        include: { user: { select: { name: true } } },
      })
      if (!frontPosition) {
        throw new Error("No one in line to remove")
      }

      // If position is locked in a transaction, cancel that transaction
      if (frontPosition.lockedBy) {
        // Mark the transaction as failed
        await tx.transaction.update({
          where: { id: frontPosition.lockedBy },
          data: { status: "FAILED" },
        })

        // Unlock any other positions locked by the same transaction
        await tx.linePosition.updateMany({
          where: { lockedBy: frontPosition.lockedBy },
          data: { lockedUntil: null, lockedBy: null },
        })
      }

      const removedUserId = frontPosition.userId
      removedUserName = frontPosition.user?.name || "Someone"

      // If NOT fulfilled, find unsettled swap transactions where this person was the buyer
      // These payments should be refunded since they never received the item
      let purchasesToRefund: { id: string; stripePaymentId: string | null; amount: number }[] = []
      if (!frontPosition.fulfilled) {
        purchasesToRefund = await tx.transaction.findMany({
          where: {
            lineId,
            buyerId: removedUserId,
            status: "COMPLETED",
            settledAt: null,
          },
          select: { id: true, stripePaymentId: true, amount: true },
        })
      }

      // If fulfilled, swap payments were already released via the fulfill endpoint
      // Just proceed with removal

      // Delete the front position
      await tx.linePosition.delete({
        where: { id: frontPosition.id },
      })

      // Shift everyone up by one
      await tx.linePosition.updateMany({
        where: {
          lineId,
          position: { gt: 1 },
        },
        data: {
          position: { decrement: 1 },
        },
      })

      // Settle any transactions where both parties have now left
      await settleTransactionsForUser(tx, lineId, removedUserId)

      return { purchasesToRefund, fulfilled: frontPosition.fulfilled }
    })

    // Cancel authorizations or refund for unfulfilled positions.
    // With auth-then-capture, uncaptured payments can be cancelled (no fees).
    // Already-captured payments fall back to a standard refund.
    if (txResult.purchasesToRefund.length > 0) {
      const needsRefund: typeof txResult.purchasesToRefund = []

      for (const purchase of txResult.purchasesToRefund) {
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
    }

    // Clear the now-serving display after removing the front person
    await prisma.line.update({
      where: { id: lineId },
      data: {
        nowServing: null,
        nowServingAt: null,
      },
    })

    return NextResponse.json({
      success: true,
      fulfilled: txResult.fulfilled,
      refundedCount,
      refundedAmount,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "No one in line to remove") {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    console.error("Remove front error:", error)
    return NextResponse.json(
      { error: "Could not remove this person. They may have already left the line." },
      { status: 500 }
    )
  }
}
