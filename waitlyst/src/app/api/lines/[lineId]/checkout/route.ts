import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { stripe, isStripeConfigured, getBaseUrl, performPositionSwap } from "@/lib/stripe"
import { lineEvents } from "@/lib/events"

const LOCK_DURATION_MS = 30 * 60 * 1000 // 30 minutes (Stripe minimum for checkout session expiry)

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

    // Check if either position is locked
    const now = new Date()
    if (buyerPosition.lockedUntil && now < buyerPosition.lockedUntil) {
      return NextResponse.json(
        { error: "Your position is currently involved in another transaction. Please wait." },
        { status: 409 }
      )
    }
    if (targetPosition.lockedUntil && now < targetPosition.lockedUntil) {
      return NextResponse.json(
        { error: "This position is currently involved in another transaction. Please wait." },
        { status: 409 }
      )
    }

    const amount = targetPosition.askingPrice

    // ─── STRIPE MODE: Create a Checkout Session ───────────────────────
    if (isStripeConfigured() && stripe) {
      const lockUntil = new Date(Date.now() + LOCK_DURATION_MS)

      // Create the pending transaction and lock positions atomically
      const transaction = await prisma.$transaction(async (tx) => {
        const txn = await tx.transaction.create({
          data: {
            buyerId: session.user.id,
            sellerId: targetPosition.userId,
            lineId,
            amount,
            status: "PENDING",
          },
        })

        // Lock both positions to prevent concurrent swaps
        await tx.linePosition.update({
          where: { id: buyerPosition.id },
          data: { lockedUntil: lockUntil, lockedBy: txn.id },
        })

        await tx.linePosition.update({
          where: { id: targetPosition.id },
          data: { lockedUntil: lockUntil, lockedBy: txn.id },
        })

        return txn
      })

      // Create Stripe Checkout Session
      const baseUrl = getBaseUrl()
      let checkoutSession
      try {
        checkoutSession = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: `Position #${targetPosition.position} in ${targetPosition.line.name}`,
                  description: `Buy position #${targetPosition.position} from ${targetPosition.user.name || "Anonymous"}`,
                },
                unit_amount: Math.round(amount * 100), // Stripe uses cents
              },
              quantity: 1,
            },
          ],
          metadata: {
            transactionId: transaction.id,
            lineId,
            buyerId: session.user.id,
            sellerId: targetPosition.userId,
          },
          success_url: `${baseUrl}/api/lines/${lineId}/complete-payment?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/api/lines/${lineId}/cancel-payment?transaction_id=${transaction.id}`,
          expires_at: Math.floor(lockUntil.getTime() / 1000),
        })
      } catch (stripeError) {
        // Stripe API call failed — clean up the locked positions and pending transaction
        console.error("Stripe checkout session creation failed:", stripeError)
        await prisma.$transaction(async (tx) => {
          await tx.linePosition.updateMany({
            where: { lockedBy: transaction.id },
            data: { lockedUntil: null, lockedBy: null },
          })
          await tx.transaction.update({
            where: { id: transaction.id },
            data: { status: "FAILED" },
          })
        })
        const msg = stripeError instanceof Error ? stripeError.message : "Payment service error"
        return NextResponse.json({ error: msg }, { status: 502 })
      }

      // Store Stripe session ID on the transaction
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { stripePaymentId: checkoutSession.id },
      })

      return NextResponse.json({
        url: checkoutSession.url,
        sessionId: checkoutSession.id,
      })
    }

    // ─── DEV MODE: Complete swap immediately without payment ──────────
    const transaction = await prisma.$transaction(async (tx) => {
      return tx.transaction.create({
        data: {
          buyerId: session.user.id,
          sellerId: targetPosition.userId,
          lineId,
          amount,
          status: "PENDING",
        },
      })
    })

    const swapped = await performPositionSwap(transaction.id)

    if (!swapped) {
      return NextResponse.json(
        { error: "Failed to complete position swap" },
        { status: 500 }
      )
    }

    lineEvents.emit(lineId, { type: "swap", lineId })

    return NextResponse.json({
      success: true,
      devMode: true,
      message: "Position swapped successfully (dev mode — no payment collected)",
    })
  } catch (error) {
    console.error("Checkout error:", error)
    const message = error instanceof Error ? error.message : "Failed to create checkout"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
