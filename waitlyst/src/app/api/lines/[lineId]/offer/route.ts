import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { lineId } = await params
  const { toUserId, amount } = await req.json()

  // Validate inputs
  if (!toUserId || typeof toUserId !== "string") {
    return NextResponse.json({ error: "toUserId is required" }, { status: 400 })
  }
  if (typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 })
  }

  try {
    // Load line settings
    const line = await prisma.line.findUnique({ where: { id: lineId } })
    if (!line) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 })
    }

    if (!line.allowResale) {
      return NextResponse.json(
        { error: "Swapping is disabled for this line" },
        { status: 400 }
      )
    }

    if (line.maxAskingPrice !== null && amount > line.maxAskingPrice) {
      return NextResponse.json(
        { error: `Amount exceeds the maximum of $${line.maxAskingPrice.toFixed(2)} for this line` },
        { status: 400 }
      )
    }

    // Get the offering user's position
    const fromPosition = await prisma.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: result.userId } },
    })
    if (!fromPosition) {
      return NextResponse.json(
        { error: "You must be in the line to make an offer" },
        { status: 400 }
      )
    }

    // Get the target user's position
    const toPosition = await prisma.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: toUserId } },
    })
    if (!toPosition) {
      return NextResponse.json(
        { error: "Target user is not in this line" },
        { status: 400 }
      )
    }

    // Validate: toUserId must be directly in front (position - 1)
    if (toPosition.position !== fromPosition.position - 1) {
      return NextResponse.json(
        { error: "You can only offer to swap with the person directly in front of you" },
        { status: 400 }
      )
    }

    // Check for existing PENDING offer from this user to this person in this line
    const existingOffer = await prisma.swapOffer.findUnique({
      where: {
        lineId_fromUserId_toUserId: {
          lineId,
          fromUserId: result.userId,
          toUserId,
        },
      },
    })
    if (existingOffer && existingOffer.status === "PENDING") {
      return NextResponse.json(
        { error: "You already have a pending offer to this person" },
        { status: 409 }
      )
    }

    // If a previous offer exists (DECLINED/ACCEPTED), upsert it back to PENDING with new amount
    const offer = await prisma.swapOffer.upsert({
      where: {
        lineId_fromUserId_toUserId: {
          lineId,
          fromUserId: result.userId,
          toUserId,
        },
      },
      update: {
        amount,
        status: "PENDING",
        createdAt: new Date(),
      },
      create: {
        lineId,
        fromUserId: result.userId,
        toUserId,
        amount,
        status: "PENDING",
      },
    })

    return NextResponse.json(offer, { status: 201 })
  } catch (error) {
    console.error("Create offer error:", error)
    const message = error instanceof Error ? error.message : "Failed to create offer"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { lineId } = await params

  try {
    // Offers I made (I'm the person behind)
    const sent = await prisma.swapOffer.findMany({
      where: { lineId, fromUserId: result.userId },
      orderBy: { createdAt: "desc" },
    })

    // Offers I received (I'm the person in front)
    const received = await prisma.swapOffer.findMany({
      where: { lineId, toUserId: result.userId },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ sent, received })
  } catch (error) {
    console.error("Get offers error:", error)
    const message = error instanceof Error ? error.message : "Failed to fetch offers"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
