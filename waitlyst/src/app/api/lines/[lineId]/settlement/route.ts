import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

// Get settlement summary for a line (owner only)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  // Get all swap transactions for this line with buyer/seller info
  const transactions = await prisma.transaction.findMany({
    where: { lineId },
    orderBy: { createdAt: "desc" },
  })

  // Get all user IDs involved
  const userIds = new Set<string>()
  for (const txn of transactions) {
    userIds.add(txn.buyerId)
    userIds.add(txn.sellerId)
  }

  // Fetch user names in bulk
  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(userIds) } },
    select: { id: true, name: true },
  })
  const userMap = new Map(users.map((u) => [u.id, u.name || "Anonymous"]))

  // Fetch current positions for all buyers
  const buyerIds = [...new Set(transactions.map((t) => t.buyerId))]
  const positions = await prisma.linePosition.findMany({
    where: { lineId, userId: { in: buyerIds } },
    select: { userId: true, position: true, fulfilled: true },
  })
  const positionMap = new Map(
    positions.map((p) => [p.userId, { position: p.position, fulfilled: p.fulfilled }])
  )

  // Build enriched transaction list
  const enrichedTransactions = transactions.map((txn) => {
    const buyerPos = positionMap.get(txn.buyerId)
    return {
      id: txn.id,
      buyerId: txn.buyerId,
      buyerName: userMap.get(txn.buyerId) || "Anonymous",
      sellerId: txn.sellerId,
      sellerName: userMap.get(txn.sellerId) || "Anonymous",
      amount: txn.amount,
      status: txn.status,
      settledAt: txn.settledAt?.toISOString() || null,
      stripePaymentId: txn.stripePaymentId,
      buyerFulfilled: buyerPos?.fulfilled ?? false,
      buyerPosition: buyerPos?.position ?? null,
      createdAt: txn.createdAt.toISOString(),
    }
  })

  // Only include COMPLETED (unsettled) transactions in settlement summary
  const completedTxns = enrichedTransactions.filter((t) => t.status === "COMPLETED")
  const fulfilledTxns = completedTxns.filter((t) => t.buyerFulfilled)
  const unfulfilledTxns = completedTxns.filter((t) => !t.buyerFulfilled)

  const totalAmount = completedTxns.reduce((sum, t) => sum + t.amount, 0)
  const capturedAmount = completedTxns.filter((t) => t.settledAt !== null).reduce((sum, t) => sum + t.amount, 0)
  const pendingAmount = completedTxns.filter((t) => t.settledAt === null).reduce((sum, t) => sum + t.amount, 0)

  return NextResponse.json({
    transactions: enrichedTransactions,
    summary: {
      total: completedTxns.length,
      fulfilled: fulfilledTxns.length,
      unfulfilled: unfulfilledTxns.length,
      totalAmount,
      capturedAmount,
      pendingAmount,
    },
  })
}
