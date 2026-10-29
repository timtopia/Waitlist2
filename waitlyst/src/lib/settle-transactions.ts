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

  if (transactions.length === 0) return 0

  // A transaction settles once neither party is in the line any more
  const parties = [...new Set(transactions.flatMap((t) => [t.buyerId, t.sellerId]))]
  const stillInLine = new Set(
    (await tx.linePosition.findMany({
      where: { lineId, userId: { in: parties } },
      select: { userId: true },
    })).map((p) => p.userId)
  )
  const settledIds = transactions
    .filter((t) => !stillInLine.has(t.buyerId) && !stillInLine.has(t.sellerId))
    .map((t) => t.id)

  // Update all settleable transactions
  if (settledIds.length > 0) {
    await tx.transaction.updateMany({
      where: { id: { in: settledIds } },
      data: { settledAt: new Date() },
    })
  }

  return settledIds.length
}
