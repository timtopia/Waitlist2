import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { buyerTotal } from "@/lib/fees"
import { expireCheckoutSession, returnBuyerFunds } from "@/lib/stripe"
import { exitQueue } from "@/lib/queue-exit"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
    const txResult = await prisma.$transaction(async (tx) => {
      const frontPosition = await tx.linePosition.findFirst({
        where: { lineId, position: 1 },
      })
      if (!frontPosition) {
        throw new Error("No one in line to remove")
      }

      // Someone removed without being served never got what they paid to
      // move up for, so their unsettled purchases go back to them. A served
      // person's purchases were already collected by the fulfill endpoint.
      const purchasesToRefund = frontPosition.fulfilled
        ? []
        : await tx.transaction.findMany({
            where: { lineId, buyerId: frontPosition.userId, status: "COMPLETED", settledAt: null },
            select: { id: true, stripePaymentId: true, amount: true, ownerFee: true, platformFee: true },
          })

      const { abandonedSessionId } = await exitQueue(tx, frontPosition, "REMOVED")
      return { purchasesToRefund, fulfilled: frontPosition.fulfilled, abandonedSessionId }
    })

    await expireCheckoutSession(txResult.abandonedSessionId)

    // Uncaptured holds are released (no fees); captured ones are refunded.
    const refundedIds = await returnBuyerFunds(txResult.purchasesToRefund)
    const refunded = txResult.purchasesToRefund.filter((p) => refundedIds.includes(p.id))
    const refundedCount = refunded.length
    const refundedAmount = refunded.reduce((sum, p) => sum + buyerTotal(p), 0)

    return NextResponse.json({
      success: true,
      fulfilled: txResult.fulfilled,
      refundedCount,
      refundedAmount,
      refundFailedCount: txResult.purchasesToRefund.length - refundedCount,
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
