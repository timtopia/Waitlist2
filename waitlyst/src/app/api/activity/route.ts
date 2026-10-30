import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { buyerTotal } from "@/lib/fees"

export const dynamic = "force-dynamic"

export async function GET() {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const userId = result.userId

  try {
    // Get recent transactions involving the user
    const [transactions, recentPositions] = await Promise.all([
      // Only money that moved: an abandoned checkout (PENDING/FAILED) never
      // charged anyone, so it isn't "bought a position"
      prisma.transaction.findMany({
        where: {
          OR: [{ buyerId: userId }, { sellerId: userId }],
          status: { in: ["COMPLETED", "REFUNDED"] },
        },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
      prisma.linePosition.findMany({
        where: { userId },
        include: {
          line: {
            select: { id: true, name: true },
          },
        },
        orderBy: { joinedAt: "desc" },
        take: 10,
      }),
    ])

    // Build activity feed
    type Activity = {
      id: string
      type: "joined" | "purchase" | "sale" | "refund"
      description: string
      amount?: number
      lineId?: string
      lineName?: string
      createdAt: string
    }

    const activities: Activity[] = []

    const txLines = await prisma.line.findMany({
      where: { id: { in: [...new Set(transactions.map((t) => t.lineId))] } },
      select: { id: true, name: true },
    })
    const lineNameOf = new Map(txLines.map((l) => [l.id, l.name]))

    // Add join events
    for (const pos of recentPositions) {
      activities.push({
        id: `join-${pos.id}`,
        type: "joined",
        description: `Joined "${pos.line.name}"`,
        lineId: pos.line.id,
        lineName: pos.line.name,
        createdAt: pos.joinedAt.toISOString(),
      })
    }

    // Add transaction events
    for (const tx of transactions) {
      const isBuyer = tx.buyerId === userId
      const lineName = lineNameOf.get(tx.lineId)
      const inLine = lineName ? ` in "${lineName}"` : ""
      const link = lineName ? { lineId: tx.lineId, lineName } : {}

      if (tx.status === "REFUNDED") {
        // The buyer gets back everything they paid, fees included
        const refunded = isBuyer ? buyerTotal(tx) : tx.amount
        activities.push({
          id: `refund-${tx.id}`,
          type: "refund",
          description: isBuyer
            ? `Received a refund of $${refunded.toFixed(2)}${inLine}`
            : `A sale of yours${inLine} was refunded ($${refunded.toFixed(2)})`,
          amount: refunded,
          ...link,
          createdAt: tx.createdAt.toISOString(),
        })
      } else if (tx.status === "COMPLETED") {
        // tx.amount is the seller's take -- correct for the seller's own
        // "Sold for $X" line, but the buyer actually paid that plus owner +
        // platform fees. Showing tx.amount for the buyer's own history
        // understated what actually left their account.
        const buyerPaid = tx.amount + (tx.ownerFee || 0) + (tx.platformFee || 0)
        activities.push({
          id: `tx-${tx.id}`,
          type: isBuyer ? "purchase" : "sale",
          description: isBuyer
            ? `Bought a position${inLine} for $${buyerPaid.toFixed(2)}`
            : `Sold a position${inLine} for $${tx.amount.toFixed(2)}`,
          amount: isBuyer ? buyerPaid : tx.amount,
          ...link,
          createdAt: tx.createdAt.toISOString(),
        })
      }
    }

    // Sort by date descending
    activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return NextResponse.json(activities.slice(0, 20))
  } catch (error) {
    console.error("Activity fetch error:", error)
    return NextResponse.json(
      { error: "Something went wrong while loading your activity. Please try again." },
      { status: 500 }
    )
  }
}
