import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { refundTransactions } from "@/lib/stripe"
import { lineEvents } from "@/lib/events"
import { settleTransactionsForUser } from "@/lib/settle-transactions"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = await params
  const { positionId, action = "payout" } = await req.json()

  if (!positionId) {
    return NextResponse.json({ error: "Position ID required" }, { status: 400 })
  }

  if (!["payout", "refund"].includes(action)) {
    return NextResponse.json({ error: "Action must be 'payout' or 'refund'" }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Check if line exists and user is the creator
      const line = await tx.line.findUnique({
        where: { id: lineId },
      })
      if (!line) {
        throw new Error("Line not found")
      }
      if (line.createdById !== session.user.id) {
        throw new Error("Only the line creator can remove people")
      }

      // Get the position to remove
      const positionToRemove = await tx.linePosition.findUnique({
        where: { id: positionId, lineId },
        include: { user: true },
      })
      if (!positionToRemove) {
        throw new Error("Position not found")
      }

      const userId = positionToRemove.userId
      let refundedAmount = 0
      let refundedCount = 0

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

      // Handle refund of all this user's purchases if action is "refund"
      if (action === "refund") {
        // Get all completed transactions where this user was the buyer
        const purchasesToRefund = await tx.transaction.findMany({
          where: {
            lineId,
            buyerId: userId,
            status: "COMPLETED",
            stripePaymentId: { not: null },
          },
        })

        // Return transactions that need Stripe refunds (done outside transaction)
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

    // Process refunds
    let refundedAmount = 0
    let refundedCount = 0

    if (action === "refund" && result.purchasesToRefund.length > 0) {
      refundedCount = await refundTransactions(result.purchasesToRefund)
      refundedAmount = result.purchasesToRefund.reduce((sum, p) => sum + p.amount, 0)

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

        // Settle any transactions where both parties have now left
        await settleTransactionsForUser(tx, lineId, result.userId)
      })
    }

    // Emit real-time update
    lineEvents.emit(lineId, { type: "leave", lineId })

    return NextResponse.json({
      success: true,
      action,
      refundedAmount,
      refundedCount,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove person"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
