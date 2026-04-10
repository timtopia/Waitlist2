import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  try {
    // Get recent transactions involving the user
    const [transactions, recentPositions] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          OR: [{ buyerId: userId }, { sellerId: userId }],
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

      if (tx.status === "REFUNDED") {
        activities.push({
          id: `refund-${tx.id}`,
          type: "refund",
          description: isBuyer
            ? `Received refund of $${tx.amount.toFixed(2)}`
            : `Refunded $${tx.amount.toFixed(2)} to buyer`,
          amount: tx.amount,
          createdAt: tx.createdAt.toISOString(),
        })
      } else if (tx.status === "COMPLETED" || tx.status === "PENDING") {
        activities.push({
          id: `tx-${tx.id}`,
          type: isBuyer ? "purchase" : "sale",
          description: isBuyer
            ? `Bought a position for $${tx.amount.toFixed(2)}`
            : `Sold a position for $${tx.amount.toFixed(2)}`,
          amount: tx.amount,
          createdAt: tx.createdAt.toISOString(),
        })
      }
    }

    // Sort by date descending
    activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return NextResponse.json(activities.slice(0, 20))
  } catch (error) {
    console.error("Activity fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 })
  }
}
