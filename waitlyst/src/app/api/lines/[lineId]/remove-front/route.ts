import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
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

  try {
    await prisma.$transaction(async (tx) => {
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

      // Get the front position
      const frontPosition = await tx.linePosition.findFirst({
        where: { lineId, position: 1 },
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

    // Emit real-time update
    lineEvents.emit(lineId, { type: "leave", lineId })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove person"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
