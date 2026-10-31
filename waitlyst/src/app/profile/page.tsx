import type { Metadata } from "next"
import { emailEnabled } from "@/lib/email"
import { buyerTotal } from "@/lib/fees"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ProfileClient } from "./ProfileClient"

export const metadata: Metadata = {
  title: "Profile",
}

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
        stripeConnectOnboarded: true,
        emailNotifications: true,
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

  // Seller earnings: paid out, collected but waiting on payout setup, or
  // still on hold until the buyer is served
  const sellerAvailable = completedAsSeller
    .filter((t) => t.sellerPaidAt !== null)
    .reduce((sum, t) => sum + t.amount, 0)
  const sellerAwaitingSetup = completedAsSeller
    .filter((t) => t.capturedAt !== null && t.sellerPaidAt === null)
    .reduce((sum, t) => sum + t.amount, 0)
  const sellerPendingSettlement = completedAsSeller
    .filter((t) => t.capturedAt === null && t.settledAt === null)
    .reduce((sum, t) => sum + t.amount, 0)
  const sellerPendingPayment = asSeller
    .filter((t) => t.status === "PENDING")
    .reduce((sum, t) => sum + t.amount, 0)

  // Owner fee earnings, split the same way
  const completedOwnerTxns = ownerTransactions.filter((t) => t.status === "COMPLETED")
  const ownerAvailable = completedOwnerTxns
    .filter((t) => t.ownerPaidAt !== null)
    .reduce((sum, t) => sum + t.ownerFee, 0)
  const ownerAwaitingSetup = completedOwnerTxns
    .filter((t) => t.capturedAt !== null && t.ownerPaidAt === null)
    .reduce((sum, t) => sum + t.ownerFee, 0)
  const ownerPendingSettlement = completedOwnerTxns
    .filter((t) => t.capturedAt === null && t.settledAt === null)
    .reduce((sum, t) => sum + t.ownerFee, 0)
  const ownerPendingPayment = ownerTransactions
    .filter((t) => t.status === "PENDING")
    .reduce((sum, t) => sum + t.ownerFee, 0)

  // The history lists money that actually moved: completed and refunded
  // purchases. Abandoned or failed checkouts never charged anyone.
  const history = transactions
    .filter((t) => t.status === "COMPLETED" || t.status === "REFUNDED")
    .slice(0, 20)
  const historyLines = await prisma.line.findMany({
    where: { id: { in: [...new Set(history.map((t) => t.lineId))] } },
    select: { id: true, name: true },
  })
  const lineNames = new Map(historyLines.map((l) => [l.id, l.name]))

  return (
    <ProfileClient
      user={{
        ...user,
        createdAt: user.createdAt.toISOString(),
      }}
      stripeConnectOnboarded={user.stripeConnectOnboarded}
      emailNotifications={user.emailNotifications}
      emailEnabled={emailEnabled()}
      stats={{
        linesCreated: ownedLineIds.length,
        activePositions,
        totalTransactions: transactions.length,
        sellerAvailable,
        sellerAwaitingSetup,
        sellerPendingSettlement,
        sellerPendingPayment,
        ownerAvailable,
        ownerAwaitingSetup,
        ownerPendingSettlement,
        ownerPendingPayment,
        purchaseCount: completedAsBuyer.length,
        saleCount: completedAsSeller.length,
      }}
      recentTransactions={history.map((t) => ({
        id: t.id,
        // A buyer paid the asking price plus both fees; a seller gets the price
        amount: t.buyerId === userId ? buyerTotal(t) : t.amount,
        lineName: lineNames.get(t.lineId) ?? null,
        status: t.status,
        role: t.buyerId === userId ? "buyer" : "seller",
        createdAt: t.createdAt.toISOString(),
        settledAt: t.settledAt?.toISOString() || null,
      }))}
    />
  )
}
