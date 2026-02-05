import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { lineEvents } from "@/lib/events"

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
    const result = await prisma.$transaction(async (tx) => {
      // Get buyer's current position
      const buyerPosition = await tx.linePosition.findUnique({
        where: { lineId_userId: { lineId, userId: session.user.id } },
      })
      if (!buyerPosition) {
        throw new Error("You must be in the line to buy a position")
      }

      if (buyerPosition.position === 1) {
        throw new Error("You are already first in line")
      }

      // Get position directly in front
      const targetPosition = await tx.linePosition.findFirst({
        where: {
          lineId,
          position: buyerPosition.position - 1,
        },
        include: { user: true },
      })
      if (!targetPosition) {
        throw new Error("No one in front of you")
      }
      if (!targetPosition.askingPrice) {
        throw new Error("This position is not for sale")
      }

      const price = targetPosition.askingPrice

      // Swap positions (use temporary position to avoid unique constraint)
      const tempPosition = -1

      await tx.linePosition.update({
        where: { id: buyerPosition.id },
        data: { position: tempPosition },
      })

      await tx.linePosition.update({
        where: { id: targetPosition.id },
        data: {
          position: buyerPosition.position,
          askingPrice: null, // Remove from sale after swap
        },
      })

      await tx.linePosition.update({
        where: { id: buyerPosition.id },
        data: { position: targetPosition.position },
      })

      // TODO: Handle actual payment transfer here (Stripe integration)

      return {
        success: true,
        newPosition: targetPosition.position,
        price: price,
        seller: {
          id: targetPosition.user.id,
          name: targetPosition.user.name,
        },
      }
    })

    // Emit real-time update
    lineEvents.emit(lineId, { type: "swap", lineId })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to buy position"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
