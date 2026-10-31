import { NextResponse } from "next/server"
import {
  getStripe,
  performPositionSwap,
  abandonPendingTransaction,
  isCheckoutAuthorized,
  recordPaymentIntent,
  payOutstandingPayouts,
} from "@/lib/stripe"
import { prisma } from "@/lib/prisma"
import type Stripe from "stripe"

/** The purchase a PaymentIntent paid for. */
async function transactionForPaymentIntent(stripe: Stripe, paymentIntentId: string) {
  const transaction = await prisma.transaction.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
  })
  if (transaction) return transaction

  // Purchases made before the PaymentIntent was recorded
  const sessions = await stripe.checkout.sessions.list({
    payment_intent: paymentIntentId,
    limit: 1,
  })
  if (sessions.data.length === 0) return null
  return prisma.transaction.findFirst({
    where: { stripePaymentId: sessions.data[0].id },
  })
}

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

        if (!transactionId) {
          console.error("Webhook: checkout.session.completed missing transactionId in metadata")
          break
        }

        // Same check as the return URL: a completed session isn't proof the
        // buyer's card was actually authorized.
        if (!(await isCheckoutAuthorized(session))) {
          console.error(`Webhook: session ${session.id} completed but payment is not authorized`)
          break
        }

        await recordPaymentIntent(transactionId, session)

        // Perform the position swap (idempotent — won't swap if already done).
        // With auth-then-capture, this fires on authorization (not capture).
        // The payment is held but not charged yet — capture happens on fulfillment.
        // If the swap can no longer happen, performPositionSwap releases the hold.
        await performPositionSwap(transactionId)

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
            await abandonPendingTransaction(transactionId, {
              offerId: session.metadata?.offerId ?? null,
              expireSession: false,
            })
          } catch (error) {
            console.error(`Webhook: Failed to clean up expired session for transaction ${transactionId}:`, error)
          }
        }

        break
      }

      case "charge.refunded": {
        // A refund was issued (possibly from Stripe dashboard). A partial
        // refund leaves the purchase standing.
        const charge = event.data.object
        if (!charge.refunded) break

        const paymentIntentId = typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id
        if (!paymentIntentId) break

        const transaction = await transactionForPaymentIntent(stripe, paymentIntentId)
        if (transaction && transaction.status !== "REFUNDED") {
          await prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: "REFUNDED", settledAt: new Date() },
          })
        }

        break
      }

      case "payment_intent.canceled": {
        // "automatic" is Stripe letting an uncollected hold lapse. Our own
        // releases cancel with other reasons and are already recorded.
        const paymentIntent = event.data.object
        if (paymentIntent.cancellation_reason !== "automatic") break

        const transaction = await transactionForPaymentIntent(stripe, paymentIntent.id)
        if (transaction && transaction.status === "COMPLETED" && !transaction.capturedAt) {
          const now = new Date()
          await prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: "FAILED", holdExpiredAt: now, settledAt: now },
          })
          console.warn(`Webhook: hold lapsed before collection for transaction ${transaction.id}`)
        }

        break
      }

      case "account.updated": {
        // Payout setup used to be recorded only when the person came back to
        // our return page; closing the tab after finishing on Stripe left it
        // unrecorded and their held payouts unsent. (Needs the endpoint to
        // receive events from connected accounts.)
        const account = event.data.object
        if (!account.charges_enabled || !account.payouts_enabled) break
        const user = await prisma.user.findFirst({
          where: { stripeConnectId: account.id, stripeConnectOnboarded: false },
          select: { id: true },
        })
        if (!user) break
        await prisma.user.update({ where: { id: user.id }, data: { stripeConnectOnboarded: true } })
        await payOutstandingPayouts(user.id)
        break
      }

      default:
        // Unhandled event type — that's fine
        break
    }
  } catch (error) {
    // Let Stripe retry: every handler is safe to run again, and a dropped
    // checkout.session.completed would leave a buyer charged but not moved.
    console.error(`Webhook handler error for ${event.type}:`, error)
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
