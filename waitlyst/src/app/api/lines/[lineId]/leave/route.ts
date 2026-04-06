import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { refundTransactions } from "@/lib/stripe"
import { lineEvents } from "@/lib/events"
import { settleTransactionsForUser } from "@/lib/settle-transactions"

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = await params
  const userId = session.user.id

  try {
    // Get position and purchases to refund
    const { position, purchasesToRefund } = await prisma.$transaction(async (tx) => {
      const position = await tx.linePosition.findUnique({
        where: { lineId_userId: { lineId, userId } },
      })
      if (!position) throw new Error("Not in this line")

      // Cancel any pending transaction this position is locked in
      if (position.lockedBy) {
        await tx.transaction.update({
          where: { id: position.lockedBy },
          data: { status: "FAILED" },
        })
        await tx.linePosition.updateMany({
          where: { lockedBy: position.lockedBy },
          data: { lockedUntil: null, lockedBy: null },
        })
      }

      const purchasesToRefund = await tx.transaction.findMany({
        where: { lineId, buyerId: userId, status: "COMPLETED" },
      })

      return { position, purchasesToRefund }
    })

    // Process refunds
    const refundedCount = await refundTransactions(purchasesToRefund)

    // Delete position and settle transactions
    await prisma.$transaction(async (tx) => {
      await tx.linePosition.delete({ where: { id: position.id } })
      await tx.linePosition.updateMany({
        where: { lineId, position: { gt: position.position } },
        data: { position: { decrement: 1 } },
      })
      await settleTransactionsForUser(tx, lineId, userId)
    })

    lineEvents.emit(lineId, {
      type: "leave",
      lineId,
      userName: session.user.name || "Someone",
    })
    return NextResponse.json({ success: true, refundedCount })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to leave line"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
