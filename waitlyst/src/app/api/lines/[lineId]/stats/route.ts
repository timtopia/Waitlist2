import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Get transaction stats for a line (owner only)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = await params

  // Verify caller is the line owner
  const line = await prisma.line.findUnique({
    where: { id: lineId },
  })

  if (!line) {
    return NextResponse.json({ error: "Line not found" }, { status: 404 })
  }

  if (line.createdById !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  // Get all transactions for this line
  const transactions = await prisma.transaction.findMany({
    where: { lineId },
    orderBy: { createdAt: "desc" },
  })

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

  return NextResponse.json({
    totalTransactions: transactions.length,
    completedCount: settledCompleted.length,
    refundedCount: refunded.length,
    pendingSettlementCount: unsettledCompleted.length,
    totalCompleted,
    totalRefunded,
    pendingSettlement,
    netRevenue: totalCompleted - totalRefunded,
    recentTransactions: transactions.slice(0, 10),
  })
}
