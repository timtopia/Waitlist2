import { NextResponse } from "next/server"
import { runAfterResponse } from "@/lib/after-response"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { sendEmail } from "@/lib/email"
import { swapOfferEmail } from "@/lib/email-templates"
import { MIN_OFFER_AMOUNT, isOfferExpired, newOfferExpiry } from "@/lib/offers"
import { tradeBlocker } from "@/lib/trading"

// Between one declined or withdrawn offer and the next to the same person
const OFFER_COOLDOWN_MS = 10 * 60 * 1000
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
  const body = await req.json()
  const toUserId = body?.toUserId
  // Stored to the cent, so every place that shows or charges it agrees
  const amount = typeof body?.amount === "number" ? Math.round(body.amount * 100) / 100 : body?.amount

  // Validate inputs
  if (!toUserId || typeof toUserId !== "string") {
    return NextResponse.json({ error: "Target user is required" }, { status: 400 })
  }
  if (typeof amount !== "number" || isNaN(amount)) {
    return NextResponse.json({ error: "Amount must be a number" }, { status: 400 })
  }
  if (amount < MIN_OFFER_AMOUNT) {
    return NextResponse.json({ error: "Offers must be at least $1.00" }, { status: 400 })
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

    if (line.isActive === false) {
      return NextResponse.json({ error: "This line is paused" }, { status: 400 })
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
      include: { user: { select: { isWalkIn: true } } },
    })
    if (!toPosition) {
      return NextResponse.json(
        { error: "Target user is not in this line" },
        { status: 400 }
      )
    }
    // Added by the host at the stand: no account, so no way to see or accept an offer
    if (toPosition.user?.isWalkIn) {
      return NextResponse.json(
        { error: "The person in front of you was added by the host and can't take offers." },
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

    const blocked =
      tradeBlocker(fromPosition, line.nowServingUserId, "yours") ??
      tradeBlocker(toPosition, line.nowServingUserId, "theirs")
    if (blocked) {
      return NextResponse.json({ error: blocked }, { status: 400 })
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
    if (existingOffer && existingOffer.status === "PENDING" && !isOfferExpired(existingOffer)) {
      return NextResponse.json(
        { error: "You already have a pending offer to this person" },
        { status: 409 }
      )
    }
    // Withdraw-and-resend (or resend right after a decline) emailed the
    // person ahead every few seconds
    if (
      existingOffer &&
      (existingOffer.status === "DECLINED" || existingOffer.status === "WITHDRAWN") &&
      existingOffer.createdAt > new Date(Date.now() - OFFER_COOLDOWN_MS)
    ) {
      return NextResponse.json(
        { error: "You just made them an offer. Wait a few minutes before sending another." },
        { status: 429 }
      )
    }
    if (existingOffer?.status === "ACCEPTED" && existingOffer.transactionId) {
      const awaitingPayment = await prisma.transaction.findFirst({
        where: { id: existingOffer.transactionId, status: "PENDING" },
        select: { id: true },
      })
      if (awaitingPayment) {
        return NextResponse.json(
          { error: "They already accepted your offer -- complete or cancel that payment first." },
          { status: 409 }
        )
      }
    }

    // A previous offer between the two (declined, expired, withdrawn, or an
    // accepted one that already went through) is reused as the new offer.
    const now = new Date()
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
        createdAt: now,
        expiresAt: newOfferExpiry(now),
        transactionId: null,
      },
      create: {
        lineId,
        fromUserId: result.userId,
        toUserId,
        amount,
        status: "PENDING",
        expiresAt: newOfferExpiry(now),
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
      runAfterResponse(() => sendEmail(toUser.email!, subject, html))
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
    const userId = result.userId
    const [offers, positions, pendingPayments] = await Promise.all([
      prisma.swapOffer.findMany({
        where: { lineId, OR: [{ fromUserId: userId }, { toUserId: userId }] },
        orderBy: { createdAt: "desc" },
      }),
      prisma.linePosition.findMany({
        where: { lineId },
        select: { userId: true, position: true },
      }),
      prisma.transaction.findMany({
        where: { lineId, status: "PENDING", OR: [{ buyerId: userId }, { sellerId: userId }] },
        select: { id: true },
      }),
    ])

    // Positions move (swaps, leaves, removals) and offers age out, so a
    // PENDING offer can silently stop meaning anything. Retire those here so
    // neither side keeps seeing an offer that accept would only reject.
    const positionOf = new Map(positions.map((p) => [p.userId, p.position]))
    const now = new Date()
    const staleIds = offers
      .filter((o) => {
        if (o.status !== "PENDING") return false
        const from = positionOf.get(o.fromUserId)
        const to = positionOf.get(o.toUserId)
        return isOfferExpired(o, now) || from === undefined || to === undefined || to !== from - 1
      })
      .map((o) => o.id)
    if (staleIds.length > 0) {
      await prisma.swapOffer.updateMany({
        where: { id: { in: staleIds }, status: "PENDING" },
        data: { status: "EXPIRED" },
      })
    }

    const pendingIds = new Set(pendingPayments.map((t) => t.id))
    const annotated = offers.map((o) => {
      const status = staleIds.includes(o.id) ? "EXPIRED" as const : o.status
      return {
        ...o,
        status,
        expiresAt: status === "PENDING" ? o.expiresAt.toISOString() : null,
        awaitingPayment: status === "ACCEPTED" && !!o.transactionId && pendingIds.has(o.transactionId),
      }
    })

    return NextResponse.json({
      sent: annotated.filter((o) => o.fromUserId === userId),
      received: annotated.filter((o) => o.toUserId === userId),
    })
  } catch (error) {
    console.error("Get offers error:", error)
    return NextResponse.json(
      { error: "Something went wrong while loading offers. Please try again." },
      { status: 500 }
    )
  }
}
