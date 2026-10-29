import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireLineOwner } from "@/lib/auth-helpers"
import { expireCheckoutSession, returnBuyerFunds } from "@/lib/stripe"
import { getPlatformFeePercent } from "@/lib/fees"
import { rateLimit } from "@/lib/rate-limit"
import { capacityView } from "@/lib/capacity"
import { auth } from "@/auth"

const getLimiter = rateLimit({ interval: 60_000, limit: 60 })

export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous"
  const { success: allowed } = getLimiter.check(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  const { lineId } = await params

  try {
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

    const session = await auth()
    const capacity = capacityView(line, line.positions.length, session?.user?.id)

    return NextResponse.json({ ...line, ...capacity, platformFeePercent: getPlatformFeePercent() }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    })
  } catch (error) {
    console.error("Get line error:", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
    // Get unsettled transactions to refund
    const { transactionsToRefund, abandonedSessions } = await prisma.$transaction(async (tx) => {
      // Fail any pending transactions
      const pending = await tx.transaction.findMany({
        where: { lineId, status: "PENDING" },
        select: { stripePaymentId: true },
      })
      await tx.transaction.updateMany({
        where: { lineId, status: "PENDING" },
        data: { status: "FAILED" },
      })

      // Find unsettled COMPLETED transactions that need refunding
      const transactionsToRefund = await tx.transaction.findMany({
        where: { lineId, status: "COMPLETED", settledAt: null },
      })
      return { transactionsToRefund, abandonedSessions: pending.map((t) => t.stripePaymentId) }
    })

    // Someone still on a payment page must not be able to pay for a spot in
    // a line that no longer exists.
    await Promise.all(abandonedSessions.map((id) => expireCheckoutSession(id)))

    // Release uncaptured holds (no fees), refund anything already captured.
    const refundedCount = await returnBuyerFunds(transactionsToRefund)

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
      // Offers aren't tied to the line by a foreign key, so clear them here.
      await tx.swapOffer.deleteMany({ where: { lineId } })
      await tx.line.delete({ where: { id: lineId } })
    })

    return NextResponse.json({ success: true, refundedCount })
  } catch (error) {
    console.error("Delete line error:", error)
    const message = error instanceof Error ? error.message : "Something went wrong. Please try again."
    const status = message === "Line not found" ? 404 : message === "Not authorized" ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
