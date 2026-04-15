import { NextResponse } from "next/server"
import { getStripe, performPositionSwap } from "@/lib/stripe"
import { prisma } from "@/lib/prisma"

export async function POST(req: Request) {
  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 503 }
    )
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set")
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    )
  }

  // Read the raw body for signature verification
  const body = await req.text()
  const signature = req.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    )
  }

  let event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error(`Webhook signature verification failed: ${message}`)
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 }
    )
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object
        const transactionId = session.metadata?.transactionId
        const lineId = session.metadata?.lineId

        if (!transactionId) {
          console.error("Webhook: checkout.session.completed missing transactionId in metadata")
          break
        }

        // Perform the position swap (idempotent — won't swap if already done).
        // With auth-then-capture, this fires on authorization (not capture).
        // The payment is held but not charged yet — capture happens on fulfillment.
        const swapped = await performPositionSwap(transactionId)

        // Note: Owner fee transfers are deferred until fulfillment (capture).
        // With auth-then-capture, the payment is not yet captured at this point,
        // so we cannot create transfers against an uncaptured charge.
        // The fulfill route handles both capture and transfers.

        break
      }

      case "checkout.session.expired": {
        // Checkout session expired without payment — clean up
        const session = event.data.object
        const transactionId = session.metadata?.transactionId

        if (transactionId) {
          try {
            await prisma.$transaction(async (tx) => {
              // Unlock positions
              await tx.linePosition.updateMany({
                where: { lockedBy: transactionId },
                data: { lockedUntil: null, lockedBy: null },
              })

              // Mark transaction as failed
              await tx.transaction.update({
                where: { id: transactionId },
                data: { status: "FAILED" },
              })
            })
          } catch (error) {
            console.error(`Webhook: Failed to clean up expired session for transaction ${transactionId}:`, error)
          }
        }

        break
      }

      case "charge.refunded": {
        // A refund was issued (possibly from Stripe dashboard)
        const charge = event.data.object
        const paymentIntentId = typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id

        if (paymentIntentId) {
          // Find the checkout session associated with this payment intent
          const sessions = await stripe.checkout.sessions.list({
            payment_intent: paymentIntentId,
            limit: 1,
          })

          if (sessions.data.length > 0) {
            const sessionId = sessions.data[0].id
            const transaction = await prisma.transaction.findFirst({
              where: { stripePaymentId: sessionId },
            })

            if (transaction && transaction.status !== "REFUNDED") {
              await prisma.transaction.update({
                where: { id: transaction.id },
                data: { status: "REFUNDED", settledAt: new Date() },
              })
            }
          }
        }

        break
      }

      default:
        // Unhandled event type — that's fine
        break
    }
  } catch (error) {
    console.error(`Webhook handler error for ${event.type}:`, error)
    // Return 200 even on handler errors to prevent Stripe from retrying indefinitely
    // The error is logged for investigation
  }

  return NextResponse.json({ received: true })
}
