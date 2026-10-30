import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { lineViewer, shortName } from "@/lib/privacy"
import { buyerTotal } from "@/lib/fees"

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
      select: { id: true, createdById: true },
    })

    if (!line) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 })
    }

    // Who traded with whom, and for how much, is only for people in the line
    // and its owner; everyone else gets the same feed without names.
    const session = await auth()
    const viewer = await lineViewer(lineId, line.createdById, session?.user?.id ?? null)
    const displayName = (name: string | null | undefined) =>
      viewer === "owner" ? name || "Someone" : viewer === "member" ? shortName(name) || "Someone" : "Someone"

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

    const userMap = new Map(users.map((u) => [u.id, displayName(u.name)]))

    type Activity = {
      id: string
      type: "join" | "purchase" | "sale" | "refund"
      description: string
      timestamp: string
    }

    const activities: Activity[] = []

    // Add join events
    for (const pos of recentPositions) {
      const name = displayName(pos.user.name)
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
          description: `${buyerName} received a refund of $${buyerTotal(tx).toFixed(2)}`,
          timestamp: tx.createdAt.toISOString(),
        })
      } else if (tx.status === "COMPLETED") {
        // tx.amount is the seller's asking price (what they receive), not
        // what the buyer actually paid -- the buyer also covers owner +
        // platform fees on top. Showing tx.amount alone as "bought for $X"
        // understated the real price and didn't match what either side saw
        // on their own screen (checkout total vs. "Listed $X").
        const buyerPaid = tx.amount + tx.ownerFee + tx.platformFee
        activities.push({
          id: `sale-${tx.id}`,
          type: "sale",
          description: `${buyerName} bought a spot from ${sellerName} for $${buyerPaid.toFixed(2)} ($${tx.amount.toFixed(2)} to ${sellerName})`,
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
