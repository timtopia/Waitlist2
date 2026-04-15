import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

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
    if (price < 0) {
      return NextResponse.json({ error: "Price cannot be negative" }, { status: 400 })
    }
    if (price > 10000) {
      return NextResponse.json({ error: "Price must be no more than $10,000" }, { status: 400 })
    }
  }

  // Enforce resale controls
  if (price !== null) {
    const line = await prisma.line.findUnique({
      where: { id: lineId },
      select: { allowResale: true, maxAskingPrice: true },
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
  }

  try {
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
