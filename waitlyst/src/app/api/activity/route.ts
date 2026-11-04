import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { buyerTotal } from "@/lib/fees"
import { formatCurrency } from "@/lib/format"

export const dynamic = "force-dynamic"

export async function GET() {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const userId = result.userId

  try {
    // Get recent transactions involving the user
    const now = new Date()
    const [transactions, recentPositions, recentVisits, openOffers] = await Promise.all([
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
      // Positions are deleted when someone leaves, so how a visit ended
      // (served, skipped as a no-show, removed) only survives here. Without
      // it, being skipped or removed while away just made the line vanish
      // from the dashboard with no trace of why.
      prisma.queueVisit.findMany({
        where: { userId },
        include: { line: { select: { id: true, name: true, kind: true } } },
        orderBy: { exitedAt: "desc" },
        take: 10,
      }),
      // Offers waiting on their answer: the one thing in the feed they need
      // to act on, and it lapses if left
      prisma.swapOffer.findMany({
        where: { toUserId: userId, status: "PENDING", expiresAt: { gt: now } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ])

    // Build activity feed
    type Activity = {
      id: string
      type: "joined" | "purchase" | "sale" | "refund" | "served" | "left" | "removed" | "offer"
      description: string
      amount?: number
      lineId?: string
      lineName?: string
      createdAt: string
    }

    const activities: Activity[] = []

    const txLines = await prisma.line.findMany({
      where: { id: { in: [...new Set([...transactions, ...openOffers].map((t) => t.lineId))] } },
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

    // Add finished visits: when they joined, and how it ended
    for (const visit of recentVisits) {
      const name = visit.line.name
      const link = { lineId: visit.line.id, lineName: name }
      activities.push({
        id: `join-visit-${visit.id}`,
        type: "joined",
        description: `Joined "${name}"`,
        ...link,
        createdAt: visit.joinedAt.toISOString(),
      })
      const exit = visit.outcome === "SERVED"
        ? { type: "served" as const, description: visit.line.kind === "RESTAURANT" ? `Seated at "${name}"` : `Served in "${name}"` }
        : visit.outcome === "NO_SHOW"
          ? { type: "removed" as const, description: `Skipped in "${name}" after not showing up in time` }
          : visit.outcome === "REMOVED"
            // Closing a line records REMOVED too: "removed by the host" read
            // like being kicked out of a line that simply closed for the night
            ? { type: "removed" as const, description: `No longer in "${name}" (removed, or the line closed)` }
            : { type: "left" as const, description: `Left "${name}"` }
      activities.push({
        id: `exit-${visit.id}`,
        ...exit,
        ...link,
        createdAt: (visit.outcome === "SERVED" ? visit.servedAt ?? visit.exitedAt : visit.exitedAt).toISOString(),
      })
    }

    for (const offer of openOffers) {
      const lineName = lineNameOf.get(offer.lineId)
      activities.push({
        id: `offer-${offer.id}`,
        type: "offer",
        description: `Received a ${formatCurrency(offer.amount)} swap offer${lineName ? ` in "${lineName}"` : ""}`,
        amount: offer.amount,
        ...(lineName && { lineId: offer.lineId, lineName }),
        createdAt: offer.createdAt.toISOString(),
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
            // A hold that was released never left their account: "refund"
            // would send them hunting their statement for money that never moved
            ? tx.capturedAt
              ? `Received a refund of ${formatCurrency(refunded)}${inLine}`
              : `Card hold of ${formatCurrency(refunded)} released${inLine}`
            : `A sale of yours${inLine} was refunded (${formatCurrency(refunded)})`,
          amount: refunded,
          ...link,
          // When it was closed out, where recorded, not when the money was
          // spent: dated at the purchase, a fresh refund sits buried below
          // newer activity
          createdAt: (tx.settledAt ?? tx.createdAt).toISOString(),
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
            ? `Bought a spot${inLine} for ${formatCurrency(buyerPaid)}${tx.capturedAt || tx.settledAt ? "" : " (not charged yet)"}`
            : `Sold a spot${inLine} for ${formatCurrency(tx.amount)}`,
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
