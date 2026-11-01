import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

/** Warn the owner when a hold lapses within this long */
const HOLD_WARNING_MS = 48 * 60 * 60 * 1000

// Get settlement summary for a line (owner only)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
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
    // Someone served and then cleared from the line has no position any more,
    // but was still served -- the visit history says so. Without this, every
    // cleared buyer looked unserved and "Cancel all unfulfilled" would
    // release their payment.
    const servedVisits = await prisma.queueVisit.findMany({
      where: { lineId, userId: { in: buyerIds }, outcome: "SERVED" },
      select: { userId: true },
    })
    const servedAndCleared = new Set(servedVisits.map((v) => v.userId))

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
        ownerFee: txn.ownerFee,
        status: txn.status,
        settledAt: txn.settledAt?.toISOString() || null,
        // Collected but not yet passed on -- the payee has no payout account.
        sellerUnpaid: !!txn.capturedAt && !txn.sellerPaidAt,
        ownerFeeUnpaid: !!txn.capturedAt && !txn.ownerPaidAt && txn.ownerFee > 0,
        stripePaymentId: txn.stripePaymentId,
        captureBefore: txn.captureBefore?.toISOString() || null,
        holdExpired: !!txn.holdExpiredAt,
        buyerFulfilled: buyerPos ? buyerPos.fulfilled : servedAndCleared.has(txn.buyerId),
        buyerPosition: buyerPos?.position ?? null,
        createdAt: txn.createdAt.toISOString(),
      }
    })

    // The "settlement" summary (fulfilled/unfulfilled, captured/pending-decision)
    // is specifically about COMPLETED (authorized) transactions waiting on an
    // owner decision to capture or release. A transaction still sitting at
    // PENDING never got that far — payment was never authorized at all (an
    // abandoned or stuck checkout) — so it's tracked separately below rather
    // than silently folded into zeros here.
    const completedTxns = enrichedTransactions.filter((t) => t.status === "COMPLETED")
    // Served/not-served only matters while a hold is still open: once a
    // payment is collected (or released) there's no decision left, and
    // "Cancel all unfulfilled" only acts on open holds.
    const openTxns = completedTxns.filter((t) => t.settledAt === null)
    const fulfilledTxns = openTxns.filter((t) => t.buyerFulfilled)
    const unfulfilledTxns = openTxns.filter((t) => !t.buyerFulfilled)

    const totalAmount = completedTxns.reduce((sum, t) => sum + t.amount, 0)
    const capturedAmount = completedTxns.filter((t) => t.settledAt !== null).reduce((sum, t) => sum + t.amount, 0)
    const pendingAmount = completedTxns.filter((t) => t.settledAt === null).reduce((sum, t) => sum + t.amount, 0)

    const now = Date.now()
    const expiringTxns = completedTxns.filter(
      (t) => t.settledAt === null && t.captureBefore && new Date(t.captureBefore).getTime() - now < HOLD_WARNING_MS
    )
    const expiredTxns = enrichedTransactions.filter((t) => t.holdExpired)

    const stuckTxns = enrichedTransactions.filter((t) => t.status === "PENDING")
    const stuckAmount = stuckTxns.reduce((sum, t) => sum + t.amount, 0)

    // What the owner actually earns from this line's swap activity -- this is
    // the number that matters for "how much can I pull out," distinct from
    // totalAmount/capturedAmount above which track the seller's side.
    const completedRawTxns = transactions.filter((t) => t.status === "COMPLETED")
    const ownerFeeCaptured = completedRawTxns
      .filter((t) => t.settledAt !== null)
      .reduce((sum, t) => sum + t.ownerFee, 0)
    const ownerFeePending = completedRawTxns
      .filter((t) => t.settledAt === null)
      .reduce((sum, t) => sum + t.ownerFee, 0)
    // Collected from the buyer but not yet sent to the owner's payout
    // account (no account yet, or the transfer failed): "earned" isn't "paid"
    const ownerFeeAwaitingPayout = transactions
      .filter((t) => t.status === "COMPLETED" && t.capturedAt && !t.ownerPaidAt && t.ownerFee > 0)
      .reduce((sum, t) => sum + t.ownerFee, 0)

    return NextResponse.json({
      transactions: enrichedTransactions,
      summary: {
        total: completedTxns.length,
        fulfilled: fulfilledTxns.length,
        unfulfilled: unfulfilledTxns.length,
        totalAmount,
        capturedAmount,
        pendingAmount,
        stuckCount: stuckTxns.length,
        stuckAmount,
        expiringCount: expiringTxns.length,
        expiredCount: expiredTxns.length,
        expiredAmount: expiredTxns.reduce((sum, t) => sum + t.amount, 0),
        ownerFeeCaptured,
        ownerFeePending,
        ownerFeeAwaitingPayout,
      },
    })
  } catch (error) {
    console.error("Settlement summary error:", error)
    return NextResponse.json(
      { error: "Something went wrong while loading settlement data. Please try again." },
      { status: 500 }
    )
  }
}
