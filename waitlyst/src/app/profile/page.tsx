import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ProfileClient } from "./ProfileClient"

export const dynamic = "force-dynamic"

export default async function ProfilePage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect("/")
  }

  const userId = session.user.id

  const [user, transactions, linesCreated, activePositions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
      },
    }),
    prisma.transaction.findMany({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.line.count({
      where: { createdById: userId },
    }),
    prisma.linePosition.count({
      where: { userId },
    }),
  ])

  if (!user) {
    redirect("/")
  }

  // Calculate stats
  const asBuyer = transactions.filter((t) => t.buyerId === userId)
  const asSeller = transactions.filter((t) => t.sellerId === userId)

  // COMPLETED transactions = active/successful
  const completedAsBuyer = asBuyer.filter((t) => t.status === "COMPLETED")
  const completedAsSeller = asSeller.filter((t) => t.status === "COMPLETED")

  const totalSpent = completedAsBuyer.reduce((sum, t) => sum + t.amount, 0)
  const totalEarned = completedAsSeller.reduce((sum, t) => sum + t.amount, 0)

  // REFUNDED transactions
  const refundedAsBuyer = asBuyer.filter((t) => t.status === "REFUNDED")
  const refundedAsSeller = asSeller.filter((t) => t.status === "REFUNDED")

  const totalRefundedToBuyer = refundedAsBuyer.reduce((sum, t) => sum + t.amount, 0)
  const totalRefundedAsSeller = refundedAsSeller.reduce((sum, t) => sum + t.amount, 0)

  // PENDING transactions
  const pendingAsBuyer = asBuyer.filter((t) => t.status === "PENDING")
  const pendingAsSeller = asSeller.filter((t) => t.status === "PENDING")
  const pendingSpend = pendingAsBuyer.reduce((sum, t) => sum + t.amount, 0)
  const pendingEarnings = pendingAsSeller.reduce((sum, t) => sum + t.amount, 0)

  return (
    <ProfileClient
      user={{
        ...user,
        createdAt: user.createdAt.toISOString(),
      }}
      stats={{
        linesCreated,
        activePositions,
        totalTransactions: transactions.length,
        totalSpent,
        totalEarned,
        netEarnings: totalEarned - totalSpent,
        pendingSpend,
        pendingEarnings,
        purchaseCount: completedAsBuyer.length,
        saleCount: completedAsSeller.length,
        totalRefundedToBuyer,
        totalRefundedAsSeller,
        refundCount: refundedAsBuyer.length + refundedAsSeller.length,
      }}
      recentTransactions={transactions.slice(0, 20).map((t) => ({
        id: t.id,
        amount: t.amount,
        status: t.status,
        role: t.buyerId === userId ? "buyer" : "seller",
        createdAt: t.createdAt.toISOString(),
        settledAt: t.settledAt?.toISOString() || null,
      }))}
    />
  )
}
