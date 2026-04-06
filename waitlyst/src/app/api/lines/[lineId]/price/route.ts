import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { lineEvents } from "@/lib/events"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = await params
  const { price } = await req.json() // null to remove from sale

  // Validate price if provided
  if (price !== null && (typeof price !== "number" || price < 0)) {
    return NextResponse.json({ error: "Invalid price" }, { status: 400 })
  }

  try {
    const position = await prisma.linePosition.update({
      where: {
        lineId_userId: {
          lineId,
          userId: session.user.id,
        },
      },
      data: { askingPrice: price },
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
    })

    // Emit real-time update
    lineEvents.emit(lineId, {
      type: "price-change",
      lineId,
      userName: position.user.name || "Someone",
      position: position.position,
    })

    return NextResponse.json(position)
  } catch (error) {
    return NextResponse.json({ error: "Position not found" }, { status: 404 })
  }
}
