import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
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
    await prisma.$transaction(async (tx) => {
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
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove person"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
