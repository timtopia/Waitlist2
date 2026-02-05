import { PrismaClient } from "@prisma/client"

type PrismaTransaction = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">

/**
 * Settle transactions for a user who just left a line.
 * A transaction is settled when both buyer and seller have left the line.
 * Only COMPLETED transactions can be settled (REFUNDED transactions don't count in stats).
 */
export async function settleTransactionsForUser(
  tx: PrismaTransaction,
  lineId: string,
  userId: string
) {
  // Find all COMPLETED transactions in this line where this user was buyer or seller
  const transactions = await tx.transaction.findMany({
    where: {
      lineId,
      status: "COMPLETED",
      settledAt: null,
      OR: [
        { buyerId: userId },
        { sellerId: userId },
      ],
    },
  })

  const now = new Date()
  const settledIds: string[] = []

  for (const transaction of transactions) {
    // Explicitly check if BOTH parties are no longer in the line
    const buyerPosition = await tx.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: transaction.buyerId } },
    })

    const sellerPosition = await tx.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: transaction.sellerId } },
    })

    // If neither party is in the line, settle the transaction
    if (!buyerPosition && !sellerPosition) {
      settledIds.push(transaction.id)
    }
  }

  // Update all settleable transactions
  if (settledIds.length > 0) {
    await tx.transaction.updateMany({
      where: { id: { in: settledIds } },
      data: { settledAt: now },
    })
  }

  return settledIds.length
}
