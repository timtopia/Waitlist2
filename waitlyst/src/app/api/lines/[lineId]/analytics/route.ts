import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { buyerTotal } from "@/lib/fees"

const DAYS = 90

/**
 * Raw history for the owner's analytics page: everyone who came through the
 * line in the last 90 days, and the swaps. Sent as timestamps, not buckets,
 * so the browser can group by the owner's own time zone.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000)
  const [visits, positions, transactions] = await Promise.all([
    prisma.queueVisit.findMany({
      where: { lineId, joinedAt: { gte: since } },
      select: { joinedAt: true, servedAt: true, outcome: true, partySize: true },
    }),
    // People still on the list count too: served-but-not-cleared and waiting
    prisma.linePosition.findMany({
      where: { lineId, joinedAt: { gte: since } },
      select: { joinedAt: true, fulfilledAt: true, fulfilled: true, partySize: true },
    }),
    prisma.transaction.findMany({
      where: { lineId, status: "COMPLETED", createdAt: { gte: since } },
      select: { createdAt: true, amount: true, ownerFee: true, platformFee: true },
    }),
  ])

  return NextResponse.json({
    days: DAYS,
    kind: result.line.kind,
    visits: [
      ...visits.map((v) => ({
        joinedAt: v.joinedAt,
        servedAt: v.servedAt,
        outcome: v.outcome,
        partySize: v.partySize,
      })),
      ...positions.map((p) => ({
        joinedAt: p.joinedAt,
        servedAt: p.fulfilled ? p.fulfilledAt : null,
        outcome: p.fulfilled ? "SERVED" : "WAITING",
        partySize: p.partySize,
      })),
    ],
    swaps: transactions.map((t) => ({
      at: t.createdAt,
      ownerFee: t.ownerFee,
      buyerPaid: buyerTotal(t),
    })),
  })
}
