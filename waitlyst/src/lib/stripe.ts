import Stripe from "stripe"
import { prisma } from "./prisma"

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia",
})

interface Transaction {
  id: string
  stripePaymentId: string | null
}

/**
 * Refund transactions via Stripe and mark them as REFUNDED.
 * Returns the count of successfully refunded transactions.
 */
export async function refundTransactions(transactions: Transaction[]): Promise<number> {
  let refundedCount = 0

  for (const txn of transactions) {
    if (!txn.stripePaymentId) continue

    try {
      await stripe.refunds.create({ payment_intent: txn.stripePaymentId })
      await prisma.transaction.update({
        where: { id: txn.id },
        data: { status: "REFUNDED", settledAt: new Date() },
      })
      refundedCount++
    } catch (error) {
      console.error(`Failed to refund transaction ${txn.id}:`, error)
    }
  }

  return refundedCount
}
