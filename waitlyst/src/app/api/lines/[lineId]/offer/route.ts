import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { sendEmail } from "@/lib/email"
import { swapOfferEmail } from "@/lib/email-templates"

const offerLimiter = rateLimit({ interval: 60_000, limit: 10 })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { success: allowed } = offerLimiter.check(result.userId)
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  const { lineId } = await params
  const { toUserId, amount } = await req.json()

  // Validate inputs
  if (!toUserId || typeof toUserId !== "string") {
    return NextResponse.json({ error: "Target user is required" }, { status: 400 })
  }
  if (typeof amount !== "number" || isNaN(amount)) {
    return NextResponse.json({ error: "Amount must be a number" }, { status: 400 })
  }
  if (amount <= 0) {
    return NextResponse.json({ error: "Amount must be greater than $0" }, { status: 400 })
  }
  if (amount > 10000) {
    return NextResponse.json({ error: "Amount must be no more than $10,000" }, { status: 400 })
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

    // Send email notification to the recipient (fire-and-forget)
    const toUser = await prisma.user.findUnique({
      where: { id: toUserId },
      select: { name: true, email: true, emailNotifications: true },
    })
    if (toUser?.email && toUser.emailNotifications) {
      const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000"
      const lineUrl = `${baseUrl}/lines/${lineId}`
      const { subject, html } = swapOfferEmail(
        toUser.name || "there",
        line.name,
        amount,
        lineUrl
      )
      sendEmail(toUser.email, subject, html).catch(() => {})
    }

    return NextResponse.json(offer, { status: 201 })
  } catch (error) {
    console.error("Create offer error:", error)
    return NextResponse.json(
      { error: "Something went wrong while creating the offer. Please try again." },
      { status: 500 }
    )
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
    return NextResponse.json(
      { error: "Something went wrong while loading offers. Please try again." },
      { status: 500 }
    )
  }
}
