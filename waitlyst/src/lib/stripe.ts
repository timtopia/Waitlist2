import Stripe from "stripe"
import { prisma } from "./prisma"

// Lazy-initialize Stripe to ensure env vars are loaded by Next.js before we read them.
// Module-level `process.env` reads can happen before Next.js injects .env values.
let _stripe: Stripe | null | undefined

export function getStripe(): Stripe | null {
  if (_stripe === undefined) {
    const key = process.env.STRIPE_SECRET_KEY
    _stripe = key ? new Stripe(key) : null
  }
  return _stripe
}


/**
 * Get the base URL for redirects.
 */
export function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000"
}

interface Transaction {
  id: string
  stripePaymentId: string | null
}

/**
 * Refund transactions via Stripe.
 * If Stripe is not configured, just marks them as REFUNDED in the database.
 * If Stripe IS configured, issues actual refunds through the Stripe API.
 *
 * NOTE: This only changes the status to REFUNDED. It does NOT set settledAt.
 * Settlement (settledAt) is a separate concern — it is set when both parties
 * have left the line, via settleTransactionsForUser().
 */
export async function refundTransactions(transactions: Transaction[]): Promise<number> {
  let refundedCount = 0
  const stripe = getStripe()

  for (const txn of transactions) {
    try {
      // If Stripe is configured and we have a session ID, issue a real refund
      if (stripe && txn.stripePaymentId) {
        try {
          // Retrieve the checkout session to get the payment intent
          const session = await stripe.checkout.sessions.retrieve(txn.stripePaymentId)

          if (session.payment_intent) {
            const paymentIntentId = typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent.id

            await stripe.refunds.create({
              payment_intent: paymentIntentId,
            })
          }
        } catch (stripeError) {
          console.error(`Stripe refund failed for transaction ${txn.id}:`, stripeError)
          // Still mark as refunded in DB even if Stripe refund fails
          // (may have already been refunded, or payment never completed)
        }
      }

      await prisma.transaction.update({
        where: { id: txn.id },
        data: { status: "REFUNDED" },
      })
      refundedCount++
    } catch (error) {
      console.error(`Failed to refund transaction ${txn.id}:`, error)
    }
  }

  return refundedCount
}

/**
 * Cancel an authorized (uncaptured) payment intent.
 * Used when removing a position that was never fulfilled — releases the hold
 * on the buyer's card with no charge and no Stripe fees.
 *
 * @param sessionId - The Stripe checkout session ID stored on the transaction
 * @returns true if cancellation succeeded, false if already cancelled/captured
 */
export async function cancelAuthorization(sessionId: string): Promise<boolean> {
  const stripe = getStripe()
  if (!stripe) return false

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (!session.payment_intent) return false

    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent.id

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

    // Only cancel if still in a cancellable state
    if (paymentIntent.status === "requires_capture") {
      await stripe.paymentIntents.cancel(paymentIntentId)
      return true
    }

    // Already cancelled or captured — nothing to do
    if (paymentIntent.status === "canceled") {
      return true
    }

    console.warn(`cancelAuthorization: payment intent ${paymentIntentId} is in unexpected state "${paymentIntent.status}"`)
    return false
  } catch (error) {
    console.error(`cancelAuthorization failed for session ${sessionId}:`, error)
    return false
  }
}

/**
 * Capture an authorized (uncaptured) payment intent.
 * Used when fulfilling a position — actually charges the buyer's card.
 *
 * @param sessionId - The Stripe checkout session ID stored on the transaction
 * @returns The captured amount in cents, or null if capture failed/was already done
 */
export async function captureAuthorization(sessionId: string): Promise<number | null> {
  const stripe = getStripe()
  if (!stripe) return null

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (!session.payment_intent) return null

    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent.id

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

    // Only capture if awaiting capture
    if (paymentIntent.status === "requires_capture") {
      const captured = await stripe.paymentIntents.capture(paymentIntentId)
      return captured.amount
    }

    // Already captured — idempotent success
    if (paymentIntent.status === "succeeded") {
      return paymentIntent.amount
    }

    console.warn(`captureAuthorization: payment intent ${paymentIntentId} is in unexpected state "${paymentIntent.status}"`)
    return null
  } catch (error) {
    console.error(`captureAuthorization failed for session ${sessionId}:`, error)
    return null
  }
}

/**
 * Perform a position swap between buyer and seller.
 * Used by both the complete-payment callback and the webhook handler.
 * Returns true if swap was performed, false if already completed.
 */
export async function performPositionSwap(transactionId: string): Promise<boolean> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
  })

  if (!transaction) {
    console.error(`Transaction ${transactionId} not found`)
    return false
  }

  // Already completed — don't swap again
  if (transaction.status === "COMPLETED") {
    return false
  }

  // Only process PENDING transactions
  if (transaction.status !== "PENDING") {
    console.error(`Transaction ${transactionId} is in ${transaction.status} status, cannot complete`)
    return false
  }

  const { lineId, buyerId, sellerId } = transaction

  await prisma.$transaction(async (tx) => {
    // Get current positions
    const buyerPosition = await tx.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: buyerId } },
    })
    const sellerPosition = await tx.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: sellerId } },
    })

    if (!buyerPosition || !sellerPosition) {
      // One of the parties left the line — mark as failed
      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: "FAILED" },
      })
      // Unlock any locked positions
      await tx.linePosition.updateMany({
        where: { lockedBy: transactionId },
        data: { lockedUntil: null, lockedBy: null },
      })
      throw new Error("One or both parties are no longer in the line")
    }

    // Swap positions using temporary position to avoid unique constraint
    const tempPosition = -1

    await tx.linePosition.update({
      where: { id: buyerPosition.id },
      data: { position: tempPosition },
    })

    await tx.linePosition.update({
      where: { id: sellerPosition.id },
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
        position: sellerPosition.position,
        lockedUntil: null,
        lockedBy: null,
      },
    })

    // Mark transaction as completed
    await tx.transaction.update({
      where: { id: transactionId },
      data: { status: "COMPLETED" },
    })
  })

  return true
}
