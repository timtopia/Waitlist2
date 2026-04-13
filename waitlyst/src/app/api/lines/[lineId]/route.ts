import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { refundTransactions } from "@/lib/stripe"
import { getPlatformFeePercent } from "@/lib/fees"

export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const line = await prisma.line.findUnique({
    where: { id: lineId },
    include: {
      createdBy: { select: { id: true, name: true, image: true } },
      positions: {
        include: { user: { select: { id: true, name: true, image: true } } },
        orderBy: { position: "asc" },
      },
    },
  })

  if (!line) {
    return NextResponse.json({ error: "Line not found" }, { status: 404 })
  }

  return NextResponse.json({ ...line, platformFeePercent: getPlatformFeePercent() }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = await params

  try {
    // Verify ownership and get unsettled transactions to refund
    const transactionsToRefund = await prisma.$transaction(async (tx) => {
      const line = await tx.line.findUnique({ where: { id: lineId } })
      if (!line) throw new Error("Line not found")
      if (line.createdById !== session.user.id) throw new Error("Not authorized")

      // Fail any pending transactions
      await tx.transaction.updateMany({
        where: { lineId, status: "PENDING" },
        data: { status: "FAILED" },
      })

      // Find unsettled COMPLETED transactions that need refunding
      return tx.transaction.findMany({
        where: { lineId, status: "COMPLETED", settledAt: null },
      })
    })

    // Refund unsettled transactions (only changes status to REFUNDED, not settledAt)
    const refundedCount = await refundTransactions(transactionsToRefund)

    // Settle ALL unsettled transactions (COMPLETED and REFUNDED) and delete line
    await prisma.$transaction(async (tx) => {
      await tx.transaction.updateMany({
        where: {
          lineId,
          settledAt: null,
          status: { in: ["COMPLETED", "REFUNDED"] },
        },
        data: { settledAt: new Date() },
      })
      await tx.line.delete({ where: { id: lineId } })
    })

    return NextResponse.json({ success: true, refundedCount })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete line"
    const status = message === "Line not found" ? 404 : message === "Not authorized" ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
