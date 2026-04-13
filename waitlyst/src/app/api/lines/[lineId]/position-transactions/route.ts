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

  // Only count COMPLETED (non-refunded) transactions for the financial summary
  const completedBuyer = asBuyer.filter((t) => t.status === "COMPLETED")
  const completedSeller = asSeller.filter((t) => t.status === "COMPLETED")
  const refundedBuyer = asBuyer.filter((t) => t.status === "REFUNDED")
  const refundedSeller = asSeller.filter((t) => t.status === "REFUNDED")

  const totalPaid = completedBuyer.reduce((sum, t) => sum + t.amount, 0)
  const totalReceived = completedSeller.reduce((sum, t) => sum + t.amount, 0)
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
  })
}
