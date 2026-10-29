import { PrismaClient } from "@prisma/client"

type PrismaTransaction = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">

/**
 * Close out refunded transactions once both buyer and seller have left a line.
 *
 * COMPLETED transactions are deliberately left alone: for them settledAt
 * means "the buyer's payment was captured and paid out" (set by fulfill or
 * the owner's settlement action). A buyer who leaves before being served
 * still holds an uncaptured authorization, and stamping settledAt here would
 * hide it from the owner's capture/release decision and report money as
 * paid out that was never collected.
 */
export async function settleTransactionsForUser(
  tx: PrismaTransaction,
  lineId: string,
  userId: string
) {
  const transactions = await tx.transaction.findMany({
    where: {
      lineId,
      status: "REFUNDED",
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
