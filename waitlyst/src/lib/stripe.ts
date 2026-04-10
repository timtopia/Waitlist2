import Stripe from "stripe"
import { prisma } from "./prisma"

// Initialize Stripe — null if secret key is not configured (dev mode)
const stripeSecretKey = process.env.STRIPE_SECRET_KEY

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey)
  : null

/**
 * Check if Stripe is configured and available.
 */
export function isStripeConfigured(): boolean {
  return stripe !== null
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
