import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  try {
    // Verify the line exists
    const line = await prisma.line.findUnique({
      where: { id: lineId },
      select: { id: true },
    })

    if (!line) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 })
    }

    // Fetch recent transactions and recent joins in parallel
    const [transactions, recentPositions] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          lineId,
          status: { in: ["COMPLETED", "REFUNDED"] },
        },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
      prisma.linePosition.findMany({
        where: { lineId },
        include: {
          user: { select: { id: true, name: true } },
        },
        orderBy: { joinedAt: "desc" },
        take: 10,
      }),
    ])

    // Look up user names for transactions
    const userIds = new Set<string>()
    for (const tx of transactions) {
      userIds.add(tx.buyerId)
      userIds.add(tx.sellerId)
    }

    const users = userIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: Array.from(userIds) } },
          select: { id: true, name: true },
        })
      : []

    const userMap = new Map(users.map((u) => [u.id, u.name || "Someone"]))

    type Activity = {
      id: string
      type: "join" | "purchase" | "sale" | "refund"
      description: string
      timestamp: string
    }

    const activities: Activity[] = []

    // Add join events
    for (const pos of recentPositions) {
      const name = pos.user.name || "Someone"
      activities.push({
        id: `join-${pos.id}`,
        type: "join",
        description: `${name} joined the line`,
        timestamp: pos.joinedAt.toISOString(),
      })
    }

    // Add transaction events
    for (const tx of transactions) {
      const buyerName = userMap.get(tx.buyerId) || "Someone"
      const sellerName = userMap.get(tx.sellerId) || "Someone"

      if (tx.status === "REFUNDED") {
        activities.push({
          id: `refund-${tx.id}`,
          type: "refund",
          description: `${buyerName} received a refund of $${tx.amount.toFixed(2)}`,
          timestamp: tx.createdAt.toISOString(),
        })
      } else if (tx.status === "COMPLETED") {
        activities.push({
          id: `sale-${tx.id}`,
          type: "sale",
          description: `${buyerName} bought a spot from ${sellerName} for $${tx.amount.toFixed(2)}`,
          timestamp: tx.createdAt.toISOString(),
        })
      }
    }

    // Sort by date descending and take top 15
    activities.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    return NextResponse.json(activities.slice(0, 15))
  } catch (error) {
    console.error("Line activity fetch error:", error)
    return NextResponse.json(
      { error: "Something went wrong while loading activity. Please try again." },
      { status: 500 }
    )
  }
}
