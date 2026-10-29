import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { settleTransactionsForUser } from "@/lib/settle-transactions"
import { expireCheckoutSession } from "@/lib/stripe"

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { lineId } = await params
  const userId = result.userId

  try {
    const abandonedSessionId = await prisma.$transaction(async (tx) => {
      const position = await tx.linePosition.findUnique({
        where: { lineId_userId: { lineId, userId } },
      })
      if (!position) throw new Error("Not in this line")

      // Cancel any pending transaction this position is locked in
      let lockedSessionId: string | null = null
      if (position.lockedBy) {
        const abandoned = await tx.transaction.update({
          where: { id: position.lockedBy },
          data: { status: "FAILED" },
        })
        lockedSessionId = abandoned?.stripePaymentId ?? null
        await tx.linePosition.updateMany({
          where: { lockedBy: position.lockedBy },
          data: { lockedUntil: null, lockedBy: null },
        })
      }

      // Delete position and shift everyone behind up
      await tx.linePosition.delete({ where: { id: position.id } })
      await tx.linePosition.updateMany({
        where: { lineId, position: { gt: position.position } },
        data: { position: { decrement: 1 } },
      })

      // Invalidate any pending swap offers to/from this user in this line —
      // the position they referred to no longer exists, so leaving a PENDING
      // offer alive would let it resurface (and even be acted on) if the
      // same two people's positions line up again after a rejoin.
      await tx.swapOffer.updateMany({
        where: {
          lineId,
          status: "PENDING",
          OR: [{ fromUserId: userId }, { toUserId: userId }],
        },
        data: { status: "DECLINED" },
      })

      // Settle any transactions where both parties have now left the line.
      // This covers both COMPLETED and REFUNDED transactions.
      // Note: We do NOT automatically refund completed purchases when a user
      // voluntarily leaves. The position swap was a legitimate trade.
      // Refunds are only issued by admin action or when a line is deleted.
      await settleTransactionsForUser(tx, lineId, userId)
      return lockedSessionId
    })

    // The other party may still have the payment page open; kill it so
    // they can't authorize a swap with someone who's gone.
    await expireCheckoutSession(abandonedSessionId)

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "Not in this line") {
      return NextResponse.json({ error: "You are not in this line" }, { status: 400 })
    }
    console.error("Leave line error:", error)
    return NextResponse.json(
      { error: "Something went wrong while leaving the line. Please try again." },
      { status: 500 }
    )
  }
}
