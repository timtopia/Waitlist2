import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { serviceStats } from "@/lib/service-stats"

// Get transaction stats for a line (owner only)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
    const [transactions, visits, positions] = await Promise.all([
      prisma.transaction.findMany({
        where: { lineId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.queueVisit.findMany({
        where: { lineId },
        select: { outcome: true, joinedAt: true, servedAt: true },
      }),
      prisma.linePosition.findMany({
        where: { lineId },
        select: { fulfilled: true, joinedAt: true, fulfilledAt: true },
      }),
    ])

    // Categorize by status (regardless of settlement)
    const completed = transactions.filter(t => t.status === "COMPLETED")
    const refunded = transactions.filter(t => t.status === "REFUNDED")

    // Settlement breakdown for COMPLETED transactions
    const settledCompleted = completed.filter(t => t.settledAt !== null)
    const unsettledCompleted = completed.filter(t => t.settledAt === null)

    // Refund totals (both settled and unsettled — all refunds count)
    const totalRefunded = refunded.reduce((sum, t) => sum + t.amount, 0)

    // Completed totals (only settled ones are "confirmed revenue")
    const totalCompleted = settledCompleted.reduce((sum, t) => sum + t.amount, 0)
    const pendingSettlement = unsettledCompleted.reduce((sum, t) => sum + t.amount, 0)

    // The owner's own cut, as opposed to the swap volume above (which is
    // money that goes to sellers).
    const ownerFeeEarned = settledCompleted.reduce((sum, t) => sum + t.ownerFee, 0)
    const ownerFeePending = unsettledCompleted.reduce((sum, t) => sum + t.ownerFee, 0)

    return NextResponse.json({
      ownerFeeEarned,
      ownerFeePending,
      totalTransactions: transactions.length,
      completedCount: settledCompleted.length,
      refundedCount: refunded.length,
      pendingSettlementCount: unsettledCompleted.length,
      totalCompleted,
      totalRefunded,
      pendingSettlement,
      netRevenue: totalCompleted - totalRefunded,
      recentTransactions: transactions.slice(0, 10),
      service: serviceStats(visits, positions),
    })
  } catch (error) {
    console.error("Stats error:", error)
    return NextResponse.json(
      { error: "Something went wrong while loading stats. Please try again." },
      { status: 500 }
    )
  }
}
