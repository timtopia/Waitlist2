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

  // Only count settled transactions (both parties have left the line)
  const settled = transactions.filter(t => t.settledAt !== null)
  const settledCompleted = settled.filter(t => t.status === "COMPLETED")
  const settledRefunded = settled.filter(t => t.status === "REFUNDED")

  // Unsettled transactions (at least one party still in line)
  const unsettled = transactions.filter(t => t.settledAt === null)
  const unsettledCompleted = unsettled.filter(t => t.status === "COMPLETED")

  const totalCompleted = settledCompleted.reduce((sum, t) => sum + t.amount, 0)
  const totalRefunded = settledRefunded.reduce((sum, t) => sum + t.amount, 0)
  const pendingSettlement = unsettledCompleted.reduce((sum, t) => sum + t.amount, 0)

  return NextResponse.json({
    totalTransactions: transactions.length,
    completedCount: settledCompleted.length,
    refundedCount: settledRefunded.length,
    pendingSettlementCount: unsettledCompleted.length,
    totalCompleted,
    totalRefunded,
    pendingSettlement,
    netRevenue: totalCompleted - totalRefunded,
    recentTransactions: transactions.slice(0, 10),
  })
}
