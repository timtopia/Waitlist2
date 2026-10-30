import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { tradeBlocker } from "@/lib/trading"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { lineId } = await params
  const { price } = await req.json() // null to remove from sale

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
      select: { allowResale: true, maxAskingPrice: true, nowServingUserId: true },
    })
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

  try {
    const current = await prisma.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: result.userId } },
      select: { lockedUntil: true },
    })
    if (current?.lockedUntil && current.lockedUntil > new Date()) {
      return NextResponse.json(
        { error: "Someone is paying for a swap with you right now. You can change your listing once it finishes." },
        { status: 409 }
      )
    }

    const position = await prisma.linePosition.update({
      where: {
        lineId_userId: {
          lineId,
          userId: result.userId,
        },
      },
      data: { askingPrice: price },
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
    })

    return NextResponse.json(position)
  } catch (error) {
    console.error("Update price error:", error)
    return NextResponse.json(
      { error: "Could not update the price. You may not be in this line." },
      { status: 404 }
    )
  }
}
