import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { tradeBlocker } from "@/lib/trading"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { lineId } = await params
  const body = await req.json() // price: null to remove from sale
  const price = typeof body?.price === "number" ? Math.round(body.price * 100) / 100 : body?.price

  // Validate price if provided
  if (price !== null) {
    if (typeof price !== "number" || isNaN(price)) {
      return NextResponse.json({ error: "Price must be a number" }, { status: 400 })
    }
    if (price < 1) {
      return NextResponse.json({ error: "Price must be at least $1.00" }, { status: 400 })
    }
    if (price > 10000) {
      return NextResponse.json({ error: "Price must be no more than $10,000" }, { status: 400 })
    }
  }

  // Enforce resale controls
  if (price !== null) {
    const line = await prisma.line.findUnique({
      where: { id: lineId },
      select: { allowResale: true, maxAskingPrice: true, nowServingUserId: true, isActive: true },
    })
    // The paused banner says swaps are off; taking a spot off sale still works
    if (line?.isActive === false) {
      return NextResponse.json({ error: "This line is paused" }, { status: 400 })
    }
    if (line && !line.allowResale) {
      return NextResponse.json(
        { error: "Swapping is disabled for this line" },
        { status: 400 }
      )
    }
    if (line && line.maxAskingPrice !== null && price > line.maxAskingPrice) {
      return NextResponse.json(
        { error: `Price exceeds the maximum of $${line.maxAskingPrice.toFixed(2)} for this line` },
        { status: 400 }
      )
    }
    const mine = await prisma.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: result.userId } },
      select: { userId: true, fulfilled: true, calledAt: true },
    })
    const blocked = mine && tradeBlocker(mine, line?.nowServingUserId ?? null, "yours")
    if (blocked) {
      return NextResponse.json({ error: blocked }, { status: 400 })
    }
  }

  const lockedMessage = "Someone is paying for a swap with you right now. You can change your listing once it finishes."
  try {
    const current = await prisma.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: result.userId } },
      select: { lockedUntil: true },
    })
    if (current?.lockedUntil && current.lockedUntil > new Date()) {
      return NextResponse.json({ error: lockedMessage }, { status: 409 })
    }

    // The update itself also requires the spot to be unlocked: a buyer's
    // checkout could lock it between the check above and here, and would
    // then pay the old price while the listing showed the new one.
    const position = await prisma.linePosition.update({
      where: {
        lineId_userId: {
          lineId,
          userId: result.userId,
        },
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
      },
      data: { askingPrice: price },
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
    })

    return NextResponse.json(position)
  } catch (error) {
    // No row matched: locked just now, or not in the line
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      const stillThere = await prisma.linePosition.findUnique({
        where: { lineId_userId: { lineId, userId: result.userId } },
        select: { id: true },
      })
      if (stillThere) return NextResponse.json({ error: lockedMessage }, { status: 409 })
    }
    console.error("Update price error:", error)
    return NextResponse.json(
      { error: "Could not update the price. You may not be in this line." },
      { status: 404 }
    )
  }
}
