import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { buyerTotal } from "@/lib/fees"
import { expireCheckoutSession, returnBuyerFunds } from "@/lib/stripe"
import { exitQueue, lockLine, removeByOrganizer, PositionNotFoundError } from "@/lib/queue-exit"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  // The dashboard names who it showed at the front. Removing "whoever is #1
  // now" could hit someone else if the queue moved since the page loaded.
  const body = await req.json().catch(() => ({}))
  if (body?.positionId !== undefined) {
    if (typeof body.positionId !== "string") {
      return NextResponse.json({ error: "Position ID must be a string" }, { status: 400 })
    }
    const target = await prisma.linePosition.findUnique({ where: { id: body.positionId, lineId } })
    if (!target) {
      return NextResponse.json(
        { error: "That person isn't in the line any more. Refresh to see who's at the front." },
        { status: 409 }
      )
    }
    try {
      // Same money rule as before: someone removed without being served gets
      // their held payments back; a served person's purchases stand.
      const removed = await removeByOrganizer(lineId, target.id, target.fulfilled ? "payout" : "refund")
      return NextResponse.json({ success: true, ...removed })
    } catch (error) {
      if (error instanceof PositionNotFoundError) {
        return NextResponse.json(
          { error: "That person isn't in the line any more. Refresh to see who's at the front." },
          { status: 409 }
        )
      }
      throw error
    }
  }

  try {
    const txResult = await prisma.$transaction(async (tx) => {
      // Lock before reading, so #1 can't change underneath us
      await lockLine(tx, lineId)
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
