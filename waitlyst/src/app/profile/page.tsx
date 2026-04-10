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

  // Get IDs of lines this user owns
  const ownedLines = await prisma.line.findMany({
    where: { createdById: userId },
    select: { id: true },
  })
  const ownedLineIds = ownedLines.map((l) => l.id)

  const [user, transactions, ownerTransactions, activePositions] = await Promise.all([
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
    // Transactions on lines this user owns (for owner fee earnings)
    ownedLineIds.length > 0
      ? prisma.transaction.findMany({
          where: {
            lineId: { in: ownedLineIds },
            ownerFee: { gt: 0 },
          },
        })
      : Promise.resolve([]),
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

  // Seller balance (from selling positions)
  const sellerBalance = completedAsSeller.reduce((sum, t) => sum + t.amount, 0)
  const pendingAsSeller = asSeller.filter((t) => t.status === "PENDING")
  const pendingSellerEarnings = pendingAsSeller.reduce((sum, t) => sum + t.amount, 0)

  // Owner balance (fees earned from lines user owns)
  const completedOwnerTxns = ownerTransactions.filter((t) => t.status === "COMPLETED")
  const pendingOwnerTxns = ownerTransactions.filter((t) => t.status === "PENDING")
  const ownerBalance = completedOwnerTxns.reduce((sum, t) => sum + t.ownerFee, 0)
  const pendingOwnerEarnings = pendingOwnerTxns.reduce((sum, t) => sum + t.ownerFee, 0)

  return (
    <ProfileClient
      user={{
        ...user,
        createdAt: user.createdAt.toISOString(),
      }}
      stats={{
        linesCreated: ownedLineIds.length,
        activePositions,
        totalTransactions: transactions.length,
        sellerBalance,
        pendingSellerEarnings,
        ownerBalance,
        pendingOwnerEarnings,
        purchaseCount: completedAsBuyer.length,
        saleCount: completedAsSeller.length,
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
