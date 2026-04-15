import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { captureAuthorization, cancelAuthorization } from "@/lib/stripe"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const authResult = await requireLineOwner(lineId)
  if (authResult instanceof NextResponse) return authResult

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

        // Only cancel transactions where the buyer was NOT fulfilled
        const unfulfilledTxns = transactions.filter(
          (t) => !fulfilledMap.get(t.buyerId)
        )

        let cancelledCount = 0
        for (const txn of unfulfilledTxns) {
          if (txn.stripePaymentId) {
            await cancelAuthorization(txn.stripePaymentId)
          }
          await prisma.transaction.update({
            where: { id: txn.id },
            data: { status: "REFUNDED", settledAt: new Date() },
          })
          cancelledCount++
        }

        return NextResponse.json({
          success: true,
          action: "cancel-all-unfulfilled",
          count: cancelledCount,
        })
      }

      // capture-all
      let capturedCount = 0
      for (const txn of transactions) {
        if (txn.stripePaymentId) {
          await captureAuthorization(txn.stripePaymentId)
        }
        await prisma.transaction.update({
          where: { id: txn.id },
          data: { settledAt: new Date() },
        })
        capturedCount++
      }

      return NextResponse.json({
        success: true,
        action: "capture-all",
        count: capturedCount,
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
      if (transaction.stripePaymentId) {
        await captureAuthorization(transaction.stripePaymentId)
      }
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { settledAt: new Date() },
      })

      return NextResponse.json({
        success: true,
        action: "capture",
        transactionId,
      })
    }

    if (action === "cancel") {
      if (transaction.stripePaymentId) {
        await cancelAuthorization(transaction.stripePaymentId)
      }
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { status: "REFUNDED", settledAt: new Date() },
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
