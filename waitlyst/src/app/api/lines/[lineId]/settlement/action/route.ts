import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { releaseAndSettle, returnBuyerFunds, abandonPendingTransaction } from "@/lib/stripe"
import { rateLimit } from "@/lib/rate-limit"

const settlementLimiter = rateLimit({ interval: 60000, limit: 20 })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const authResult = await requireLineOwner(lineId)
  if (authResult instanceof NextResponse) return authResult

  const { success } = settlementLimiter.check(authResult.userId)
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: { "Retry-After": "60" } })
  }

  const body = await req.json()
  const { transactionId, action } = body as {
    transactionId?: string
    action: "capture" | "cancel" | "capture-all" | "cancel-all-unfulfilled"
  }

  if (!action || typeof action !== "string") {
    return NextResponse.json({ error: "Action is required" }, { status: 400 })
  }

  const validActions = ["capture", "cancel", "capture-all", "cancel-all-unfulfilled"]
  if (!validActions.includes(action)) {
    return NextResponse.json(
      { error: `Action must be one of: ${validActions.join(", ")}` },
      { status: 400 }
    )
  }

  try {
    // --- Bulk actions ---
    if (action === "capture-all" || action === "cancel-all-unfulfilled") {
      // Get all COMPLETED, unsettled transactions for this line
      const transactions = await prisma.transaction.findMany({
        where: { lineId, status: "COMPLETED", settledAt: null },
      })

      if (action === "cancel-all-unfulfilled") {
        // Get buyer positions to determine fulfillment
        const buyerIds = [...new Set(transactions.map((t) => t.buyerId))]
        const positions = await prisma.linePosition.findMany({
          where: { lineId, userId: { in: buyerIds } },
          select: { userId: true, fulfilled: true },
        })
        const fulfilledMap = new Map(positions.map((p) => [p.userId, p.fulfilled]))
        // Served and already cleared from the line: still served
        const servedVisits = await prisma.queueVisit.findMany({
          where: { lineId, userId: { in: buyerIds }, outcome: "SERVED" },
          select: { userId: true },
        })
        for (const v of servedVisits) if (!fulfilledMap.has(v.userId)) fulfilledMap.set(v.userId, true)

        // Buyers still waiting hold the spot they bought: releasing their
        // payment would hand it to them free, and the seller gets nothing.
        // They're refunded when they leave or are removed instead.
        const stillWaiting = new Set(positions.filter((p) => !p.fulfilled).map((p) => p.userId))

        // Only cancel transactions where the buyer was NOT fulfilled
        const unfulfilledTxns = transactions.filter(
          (t) => !fulfilledMap.get(t.buyerId) && !stillWaiting.has(t.buyerId)
        )

        // Release the hold, or refund it if it was already collected. Only
        // purchases whose money really went back are closed out.
        const returnedIds = await returnBuyerFunds(unfulfilledTxns)
        if (returnedIds.length > 0) {
          await prisma.transaction.updateMany({
            where: { id: { in: returnedIds } },
            data: { settledAt: new Date() },
          })
        }

        return NextResponse.json({
          success: true,
          action: "cancel-all-unfulfilled",
          count: returnedIds.length,
          failedCount: unfulfilledTxns.length - returnedIds.length,
        })
      }

      // capture-all
      let capturedCount = 0
      let failedCount = 0
      for (const txn of transactions) {
        if (!(await releaseAndSettle(txn))) {
          failedCount++
          continue
        }
        capturedCount++
      }

      return NextResponse.json({
        success: true,
        action: "capture-all",
        count: capturedCount,
        failedCount,
      })
    }

    // --- Single transaction actions ---
    if (!transactionId) {
      return NextResponse.json(
        { error: "Transaction ID is required for individual actions" },
        { status: 400 }
      )
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    })

    if (!transaction || transaction.lineId !== lineId) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      )
    }

    // A PENDING transaction never got as far as an authorized payment — it's
    // an abandoned or stuck checkout, not something to "capture" or "release
    // a hold" on. The only sane owner action is cancelling it outright so the
    // locked positions free up and the queue stops showing a phantom swap.
    if (transaction.status === "PENDING") {
      if (action !== "cancel") {
        return NextResponse.json(
          { error: "A pending (unpaid) checkout can only be cancelled, not captured." },
          { status: 400 }
        )
      }

      // Also kills the Stripe session so a stale link the buyer still has
      // can't be used, and puts an accepted offer back to PENDING.
      await abandonPendingTransaction(transactionId)

      return NextResponse.json({ success: true, action: "cancel", transactionId })
    }

    if (transaction.status !== "COMPLETED") {
      return NextResponse.json(
        { error: "Transaction is not in a settleable state" },
        { status: 400 }
      )
    }

    if (transaction.settledAt) {
      return NextResponse.json(
        { error: "Transaction is already settled" },
        { status: 400 }
      )
    }

    if (action === "capture") {
      if (!(await releaseAndSettle(transaction))) {
        return NextResponse.json(
          { error: "Couldn't collect this payment -- the card hold may have expired. You can release it instead." },
          { status: 402 }
        )
      }

      return NextResponse.json({
        success: true,
        action: "capture",
        transactionId,
      })
    }

    if (action === "cancel") {
      const stillWaiting = await prisma.linePosition.findFirst({
        where: { lineId, userId: transaction.buyerId, fulfilled: false },
        select: { id: true },
      })
      if (stillWaiting) {
        return NextResponse.json(
          { error: "They're still in line in the spot they bought. Remove them with a refund instead, or collect the payment." },
          { status: 409 }
        )
      }
      const [returnedId] = await returnBuyerFunds([transaction])
      if (!returnedId) {
        return NextResponse.json(
          { error: "Couldn't return this payment to the buyer. Nothing was changed -- please try again, or check it in Stripe." },
          { status: 502 }
        )
      }
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { settledAt: new Date() },
      })

      return NextResponse.json({
        success: true,
        action: "cancel",
        transactionId,
      })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("Settlement action error:", error)
    return NextResponse.json(
      { error: "Something went wrong while processing the settlement. Please try again." },
      { status: 500 }
    )
  }
}
