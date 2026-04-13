import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
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
    await prisma.$transaction(async (tx) => {
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

      // Delete position and shift everyone behind up
      await tx.linePosition.delete({ where: { id: position.id } })
      await tx.linePosition.updateMany({
        where: { lineId, position: { gt: position.position } },
        data: { position: { decrement: 1 } },
      })

      // Settle any transactions where both parties have now left the line.
      // This covers both COMPLETED and REFUNDED transactions.
      // Note: We do NOT automatically refund completed purchases when a user
      // voluntarily leaves. The position swap was a legitimate trade.
      // Refunds are only issued by admin action or when a line is deleted.
      await settleTransactionsForUser(tx, lineId, userId)
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to leave line"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
