import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

// Get transaction info for a specific user in a line
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const url = new URL(req.url)
  const userId = url.searchParams.get("userId")

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 })
  }

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  // Get all completed AND refunded transactions where this user was buyer or seller.
  // We include REFUNDED so the admin has full visibility into this user's transaction history.
  const [asBuyer, asSeller] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        lineId,
        buyerId: userId,
        status: { in: ["COMPLETED", "REFUNDED"] },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.transaction.findMany({
      where: {
        lineId,
        sellerId: userId,
        status: { in: ["COMPLETED", "REFUNDED"] },
      },
      orderBy: { createdAt: "desc" },
    }),
  ])

  // Find downstream buyers — people who bought positions from this user.
  // If this user is removed, these buyers' transactions may be affected.
  const completedSales = asSeller.filter((t) => t.status === "COMPLETED")
  const buyerIds = [...new Set(completedSales.map((t) => t.buyerId))]

  let downstreamBuyers: { id: string; name: string | null; amount: number; transactionId: string }[] = []
  if (buyerIds.length > 0) {
    const buyers = await prisma.user.findMany({
      where: { id: { in: buyerIds } },
      select: { id: true, name: true },
    })
    const buyerMap = new Map(buyers.map((b) => [b.id, b.name]))
    downstreamBuyers = completedSales.map((t) => ({
      id: t.buyerId,
      name: buyerMap.get(t.buyerId) ?? null,
      amount: t.amount,
      transactionId: t.id,
    }))
  }

  // Only count COMPLETED (non-refunded) transactions for the financial summary
  const completedBuyer = asBuyer.filter((t) => t.status === "COMPLETED")
  const refundedBuyer = asBuyer.filter((t) => t.status === "REFUNDED")
  const refundedSeller = asSeller.filter((t) => t.status === "REFUNDED")

  const totalPaid = completedBuyer.reduce((sum, t) => sum + t.amount, 0)
  const totalReceived = completedSales.reduce((sum, t) => sum + t.amount, 0)
  const totalRefundedToBuyer = refundedBuyer.reduce((sum, t) => sum + t.amount, 0)
  const totalRefundedAsSeller = refundedSeller.reduce((sum, t) => sum + t.amount, 0)

  return NextResponse.json({
    asBuyer,
    asSeller,
    totalPaid,
    totalReceived,
    totalRefundedToBuyer,
    totalRefundedAsSeller,
    netAmount: totalReceived - totalPaid,
    downstreamBuyers,
  })
}
