import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { stripe } from "@/lib/stripe"
import { lineEvents } from "@/lib/events"

// Lock duration: 10 minutes for Stripe checkout
const LOCK_DURATION_MS = 10 * 60 * 1000

function isPositionLocked(position: { lockedUntil: Date | null }): boolean {
  if (!position.lockedUntil) return false
  return new Date() < position.lockedUntil
}

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

    // Check if buyer's position is locked
    if (isPositionLocked(buyerPosition)) {
      return NextResponse.json(
        { error: "Your position is currently involved in another transaction. Please wait." },
        { status: 409 }
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

    // Check if target position is locked
    if (isPositionLocked(targetPosition)) {
      return NextResponse.json(
        { error: "This position is currently involved in another transaction. Please wait." },
        { status: 409 }
      )
    }

    const priceInCents = Math.round(targetPosition.askingPrice * 100)

    // Create a pending transaction and lock both positions atomically
    const lockUntil = new Date(Date.now() + LOCK_DURATION_MS)

    const transaction = await prisma.$transaction(async (tx) => {
      // Double-check locks inside transaction
      const freshBuyer = await tx.linePosition.findUnique({
        where: { id: buyerPosition.id },
      })
      const freshSeller = await tx.linePosition.findUnique({
        where: { id: targetPosition.id },
      })

      if (!freshBuyer || !freshSeller) {
        throw new Error("Positions no longer exist")
      }

      if (isPositionLocked(freshBuyer) || isPositionLocked(freshSeller)) {
        throw new Error("Position is locked by another transaction")
      }

      // Create transaction record
      const txRecord = await tx.transaction.create({
        data: {
          buyerId: session.user.id,
          sellerId: targetPosition.userId,
          lineId,
          amount: targetPosition.askingPrice!,
          status: "PENDING",
        },
      })

      // Lock both positions
      await tx.linePosition.update({
        where: { id: buyerPosition.id },
        data: { lockedUntil: lockUntil, lockedBy: txRecord.id },
      })

      await tx.linePosition.update({
        where: { id: targetPosition.id },
        data: { lockedUntil: lockUntil, lockedBy: txRecord.id },
      })

      return txRecord
    })

    // Get base URL for redirects
    const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000"

    // Check if Stripe is configured
    if (!process.env.STRIPE_SECRET_KEY) {
      // Dev mode: complete swap immediately without payment
      await prisma.$transaction(async (tx) => {
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

        await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: "COMPLETED" },
        })
      })

      lineEvents.emit(lineId, { type: "swap", lineId })

      return NextResponse.json({
        success: true,
        devMode: true,
        message: "Position swapped (dev mode - no payment)"
      })
    }

    // Production: Create Stripe checkout session
    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Position #${targetPosition.position} in ${targetPosition.line.name}`,
              description: `Buy position from ${targetPosition.user.name || "Anonymous"}`,
            },
            unit_amount: priceInCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${baseUrl}/api/lines/${lineId}/complete-payment?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/api/lines/${lineId}/cancel-payment?transaction_id=${transaction.id}`,
      metadata: {
        transactionId: transaction.id,
        lineId,
        buyerId: session.user.id,
        sellerId: targetPosition.userId,
        buyerPositionId: buyerPosition.id,
        sellerPositionId: targetPosition.id,
      },
    })

    return NextResponse.json({ url: checkoutSession.url })
  } catch (error) {
    console.error("Checkout error:", error)
    const message = error instanceof Error ? error.message : "Failed to create checkout"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
