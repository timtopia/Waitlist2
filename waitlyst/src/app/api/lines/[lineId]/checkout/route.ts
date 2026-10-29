import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { getStripe, getBaseUrl, performPositionSwap, lockPositionsForTransaction } from "@/lib/stripe"
import { calculateFees } from "@/lib/fees"
import { rateLimit } from "@/lib/rate-limit"

const checkoutLimiter = rateLimit({ interval: 60_000, limit: 10 })

const LOCK_DURATION_MS = 30 * 60 * 1000 // 30 minutes (Stripe minimum for checkout session expiry)

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { success: allowed } = checkoutLimiter.check(result.userId)
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  const { lineId } = await params
  const body = await req.json().catch(() => ({}))
  const expectedPrice: unknown = body?.expectedPrice
  const expectedSellerId: unknown = body?.expectedSellerId

  try {
    // Check if line is active (not paused)
    const line = await prisma.line.findUnique({ where: { id: lineId } })
    if (!line || !line.isActive) {
      return NextResponse.json(
        { error: "This line is currently paused" },
        { status: 400 }
      )
    }

    // Check if resale is allowed
    if (!line.allowResale) {
      return NextResponse.json(
        { error: "Swapping is disabled for this line" },
        { status: 400 }
      )
    }

    // Get buyer's current position
    const buyerPosition = await prisma.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: result.userId } },
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
      // Note: you can only ever buy the position directly in front of you
      // (enforced by the query above), never an arbitrary listed position
      // further ahead -- so this message is specifically about your actual
      // neighbor, not about whichever listing you may have had in mind.
      return NextResponse.json(
        { error: "The person directly in front of you hasn't listed their position for sale." },
        { status: 400 }
      )
    }

    // The buyer agreed to a specific price from a specific person. If the
    // seller re-priced, or the person in front changed (a swap or leave
    // landed first), don't silently charge them for a different deal.
    if (typeof expectedSellerId === "string" && expectedSellerId !== targetPosition.userId) {
      return NextResponse.json(
        { error: "The person in front of you changed. Review the new listing before buying.", code: "STALE_LISTING" },
        { status: 409 }
      )
    }
    if (typeof expectedPrice === "number" && Math.abs(expectedPrice - targetPosition.askingPrice) > 0.001) {
      return NextResponse.json(
        { error: `The asking price changed to $${targetPosition.askingPrice.toFixed(2)}. Review it before buying.`, code: "STALE_LISTING" },
        { status: 409 }
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

    const askingPrice = targetPosition.askingPrice
    const fees = calculateFees(askingPrice, targetPosition.line.ownerFeePercent)

    // ─── STRIPE MODE: Create a Checkout Session ───────────────────────
    const stripe = getStripe()
    if (stripe) {
      const lockUntil = new Date(Date.now() + LOCK_DURATION_MS)

      // Create the pending transaction and lock positions atomically
      let transaction
      try {
        transaction = await prisma.$transaction(async (tx) => {
          const txn = await tx.transaction.create({
            data: {
              buyerId: result.userId,
              sellerId: targetPosition.userId,
              lineId,
              amount: askingPrice,
              ownerFee: fees.ownerFee,
              platformFee: fees.platformFee,
              status: "PENDING",
            },
          })

          const locked = await lockPositionsForTransaction(
            tx,
            [buyerPosition.id, targetPosition.id],
            txn.id,
            lockUntil
          )
          if (!locked) throw new Error("POSITIONS_LOCKED")

          return txn
        })
      } catch (error) {
        if (error instanceof Error && error.message === "POSITIONS_LOCKED") {
          return NextResponse.json(
            { error: "This position is currently involved in another transaction. Please wait." },
            { status: 409 }
          )
        }
        throw error
      }

      // Look up seller's Stripe Connect account for payment splitting
      const seller = await prisma.user.findUnique({
        where: { id: targetPosition.userId },
        select: { stripeConnectId: true, stripeConnectOnboarded: true },
      })

      // Create Stripe Checkout Session
      const baseUrl = getBaseUrl()
      let checkoutSession

      // Build payment_intent_data for Connect splits
      // If seller has a connected account, send seller's amount via transfer_data
      // and keep platform fee + owner fee as application_fee_amount.
      // If seller has no connected account, all money goes to platform and
      // releaseFunds() transfers it once they are fulfilled (or onboard).
      // The owner fee is always transferred at release time, to whatever
      // account the owner has by then.
      const sellerConnected = seller?.stripeConnectId && seller?.stripeConnectOnboarded

      const paymentIntentData: Record<string, unknown> = {
        capture_method: "manual", // Authorize only — capture happens on fulfillment
      }
      if (sellerConnected) {
        // application_fee_amount = platformFee + ownerFee (in cents)
        // transfer_data.destination sends the rest (asking price) to seller
        paymentIntentData.application_fee_amount = Math.round((fees.platformFee + fees.ownerFee) * 100)
        paymentIntentData.transfer_data = {
          destination: seller.stripeConnectId,
        }
      }

      try {
        const sessionParams: Record<string, unknown> = {
          mode: "payment",
          // automatic_tax: { enabled: true }, // Enable when Stripe Tax is configured in dashboard
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: `Position #${targetPosition.position} in ${targetPosition.line.name}`,
                  description: `Buy position #${targetPosition.position} from ${targetPosition.user.name || "Anonymous"}`,
                },
                unit_amount: Math.round(fees.totalPrice * 100), // Stripe uses cents — total includes fees
              },
              quantity: 1,
            },
          ],
          metadata: {
            transactionId: transaction.id,
            lineId,
            buyerId: result.userId,
            sellerId: targetPosition.userId,
          },
          success_url: `${baseUrl}/api/lines/${lineId}/complete-payment?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/api/lines/${lineId}/cancel-payment?transaction_id=${transaction.id}`,
          expires_at: Math.floor(lockUntil.getTime() / 1000),
          payment_intent_data: paymentIntentData,
        }

        checkoutSession = await stripe.checkout.sessions.create(
          sessionParams as Parameters<typeof stripe.checkout.sessions.create>[0]
        )
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
          buyerId: result.userId,
          sellerId: targetPosition.userId,
          lineId,
          amount: askingPrice,
          ownerFee: fees.ownerFee,
          platformFee: fees.platformFee,
          status: "PENDING",
        },
      })
    })

    const swapped = await performPositionSwap(transaction.id)

    if (!swapped) {
      return NextResponse.json(
        { error: "The queue changed before the swap could finish. Please refresh and try again." },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      devMode: true,
      message: "Position swapped successfully (dev mode — no payment collected)",
    })
  } catch (error) {
    console.error("Checkout error:", error)
    return NextResponse.json(
      { error: "Something went wrong while starting checkout. Please try again." },
      { status: 500 }
    )
  }
}
