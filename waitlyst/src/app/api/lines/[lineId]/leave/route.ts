import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { exitQueue, lockLine } from "@/lib/queue-exit"
import { expireCheckoutSession, releaseAndSettle } from "@/lib/stripe"

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { lineId } = await params
  const userId = result.userId

  try {
    const { abandonedSessionId, purchases } = await prisma.$transaction(async (tx) => {
      // Lock before reading: another exit ahead could shift this position
      await lockLine(tx, lineId)
      const position = await tx.linePosition.findUnique({
        where: { lineId_userId: { lineId, userId } },
      })
      if (!position) throw new Error("Not in this line")

      const { abandonedSessionId } = await exitQueue(tx, position, "LEFT")

      const purchases = await tx.transaction.findMany({
        where: { lineId, buyerId: userId, status: "COMPLETED", settledAt: null },
      })
      return { abandonedSessionId, purchases }
    })

    // The other party may still have the payment page open; kill it so
    // they can't authorize a swap with someone who's gone.
    await expireCheckoutSession(abandonedSessionId)

    // Leaving doesn't undo a trade: the people this buyer paid gave up their
    // places for it, so collect the payment and pay them now rather than
    // leaving it on hold until it lapses and nobody gets paid.
    let purchasesCollected = 0
    for (const purchase of purchases) {
      if (await releaseAndSettle(purchase)) purchasesCollected++
    }

    return NextResponse.json({ success: true, purchasesCollected })
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
