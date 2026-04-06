import { prisma } from "./prisma"

interface Transaction {
  id: string
  stripePaymentId: string | null
}

/**
 * Refund transactions — currently a no-op for Stripe (payment integration to be added later).
 * Marks transactions as REFUNDED in the database.
 */
export async function refundTransactions(transactions: Transaction[]): Promise<number> {
  let refundedCount = 0

  for (const txn of transactions) {
    try {
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
