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
    // Get buyer's current position
    const buyerPosition = await prisma.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: session.user.id } },
    })
    if (!buyerPosition) {
      return NextResponse.json(
        { error: "You must be in the line to buy a position" },
        { status: 400 }
      )
    }

    if (buyerPosition.position === 1) {
      return NextResponse.json(
        { error: "You are already first in line" },
        { status: 400 }
      )
    }

    // Get position directly in front
    const targetPosition = await prisma.linePosition.findFirst({
      where: {
        lineId,
        position: buyerPosition.position - 1,
      },
      include: { user: true, line: true },
    })

    if (!targetPosition) {
      return NextResponse.json(
        { error: "No one in front of you" },
        { status: 400 }
      )
    }

    if (!targetPosition.askingPrice) {
      return NextResponse.json(
        { error: "This position is not for sale" },
        { status: 400 }
      )
    }

    // Check if either position is locked
    const now = new Date()
    if (buyerPosition.lockedUntil && now < buyerPosition.lockedUntil) {
      return NextResponse.json(
        { error: "Your position is currently involved in another transaction. Please wait." },
        { status: 409 }
      )
    }
    if (targetPosition.lockedUntil && now < targetPosition.lockedUntil) {
      return NextResponse.json(
        { error: "This position is currently involved in another transaction. Please wait." },
        { status: 409 }
      )
    }

    // Dev mode: complete swap immediately without payment
    await prisma.$transaction(async (tx) => {
      // Create transaction record
      await tx.transaction.create({
        data: {
          buyerId: session.user.id,
          sellerId: targetPosition.userId,
          lineId,
          amount: targetPosition.askingPrice!,
          status: "COMPLETED",
        },
      })

      // Swap positions using temporary position to avoid unique constraint
      const tempPosition = -1

      await tx.linePosition.update({
        where: { id: buyerPosition.id },
        data: { position: tempPosition },
      })

      await tx.linePosition.update({
        where: { id: targetPosition.id },
        data: {
          position: buyerPosition.position,
          askingPrice: null,
          lockedUntil: null,
          lockedBy: null,
        },
      })

      await tx.linePosition.update({
        where: { id: buyerPosition.id },
        data: {
          position: targetPosition.position,
          lockedUntil: null,
          lockedBy: null,
        },
      })
    })

    lineEvents.emit(lineId, { type: "swap", lineId })

    return NextResponse.json({
      success: true,
      devMode: true,
      message: "Position swapped successfully"
    })
  } catch (error) {
    console.error("Checkout error:", error)
    const message = error instanceof Error ? error.message : "Failed to create checkout"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
