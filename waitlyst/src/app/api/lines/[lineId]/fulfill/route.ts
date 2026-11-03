import { NextResponse } from "next/server"
import { runAfterResponse } from "@/lib/after-response"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { abandonPendingTransaction, getBaseUrl, releaseAndSettle } from "@/lib/stripe"
import { sendEmail } from "@/lib/email"
import { fulfilledEmail } from "@/lib/email-templates"
import { clearNowServing } from "@/lib/queue-exit"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const body = await req.json().catch(() => null)
  const positionId = body && typeof body === "object" ? body.positionId : undefined

  if (!positionId || typeof positionId !== "string") {
    return NextResponse.json({ error: "Position ID is required" }, { status: 400 })
  }

  const authResult = await requireLineOwner(lineId)
  if (authResult instanceof NextResponse) return authResult

  try {
    // Someone mid-checkout to buy this spot (or this party buying ahead)
    // kept the host from seating them for up to half an hour. Being served
    // takes the spot off the market anyway, so call that swap off first --
    // the same as calling them up does (the buyer's hold is released).
    const lock = await prisma.linePosition.findUnique({
      where: { id: positionId, lineId },
      select: { lockedBy: true, lockedUntil: true, fulfilled: true },
    })
    if (lock && !lock.fulfilled && lock.lockedBy && lock.lockedUntil && lock.lockedUntil > new Date()) {
      await abandonPendingTransaction(lock.lockedBy, { offerOutcome: "expire" })
    }

    const result = await prisma.$transaction(async (tx) => {
      // Get the position to fulfill
      const position = await tx.linePosition.findUnique({
        where: { id: positionId, lineId },
        include: { user: true },
      })
      if (!position) {
        throw new Error("Position not found")
      }

      if (position.fulfilled) {
        throw new Error("Position already fulfilled")
      }

      if (position.lockedUntil && position.lockedUntil > new Date()) {
        throw new Error("Position locked")
      }

      // Conditional so two concurrent fulfills can't both release payouts.
      // A served spot can't be traded, so its listing comes down with it.
      const marked = await tx.linePosition.updateMany({
        where: { id: positionId, fulfilled: false },
        data: {
          fulfilled: true,
          fulfilledAt: new Date(),
          askingPrice: null,
        },
      })
      if (marked.count === 0) {
        // Either a co-host just seated them, or they left the line meanwhile.
        const still = await tx.linePosition.findUnique({ where: { id: positionId }, select: { id: true } })
        throw new Error(still ? "Position already fulfilled" : "Position not found")
      }
      // Once they're served, "Now serving" shouldn't keep showing them to
      // everyone until the owner clears served people.
      await clearNowServing(tx, lineId, position.userId)
      await tx.swapOffer.updateMany({
        where: {
          lineId,
          status: "PENDING",
          OR: [{ fromUserId: position.userId }, { toUserId: position.userId }],
        },
        data: { status: "EXPIRED" },
      })

      // Find all COMPLETED transactions where this user was the BUYER
      // (they paid to swap forward). Release payment to the sellers.
      const buyerTransactions = await tx.transaction.findMany({
        where: {
          lineId,
          buyerId: position.userId,
          status: "COMPLETED",
          settledAt: null,
        },
      })

      return { position, buyerTransactions }
    })

    // Capture each purchase and pay seller + owner. A purchase is only marked
    // settled once its money was actually collected; one whose hold lapsed
    // stays open on the settlement page instead of looking paid out.
    let payoutsReleased = 0
    let payoutsFailed = 0
    for (const txn of result.buyerTransactions) {
      if (await releaseAndSettle(txn)) {
        payoutsReleased++
      } else {
        payoutsFailed++
      }
    }

    // Send email notification to the fulfilled person (fire-and-forget)
    const fulfilledUser = result.position.user
    if (fulfilledUser?.email && fulfilledUser.emailNotifications) {
      const line = await prisma.line.findUnique({ where: { id: lineId }, select: { name: true, kind: true } })
      if (line) {
        const lineUrl = `${getBaseUrl()}/lines/${lineId}`
        const { subject, html } = fulfilledEmail(
          fulfilledUser.name || "there",
          line.name,
          lineUrl,
          { isRestaurant: line.kind === "RESTAURANT" }
        )
        runAfterResponse(() => sendEmail(fulfilledUser.email!, subject, html))
      }
    }

    return NextResponse.json({
      fulfilled: true,
      payoutsReleased,
      payoutsFailed,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "Position not found") {
      return NextResponse.json(
        { error: "Could not find this position. The person may have already left the line." },
        { status: 404 }
      )
    }
    if (message === "Position already fulfilled") {
      return NextResponse.json(
        { error: "Already marked as seated or served -- someone may have just done it" },
        { status: 400 }
      )
    }
    if (message === "Position locked") {
      return NextResponse.json(
        { error: "This position is in the middle of a pending swap and can't be fulfilled until it completes or the lock expires." },
        { status: 409 }
      )
    }
    console.error("Fulfill error:", error)
    return NextResponse.json(
      { error: "Something went wrong while fulfilling this position. Please try again." },
      { status: 500 }
    )
  }
}
