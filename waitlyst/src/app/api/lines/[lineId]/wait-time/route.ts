import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  try {
    const line = await prisma.line.findUnique({
      where: { id: lineId },
      select: { id: true, createdAt: true },
    })
    if (!line) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 })
    }

    // Strategy 1: Use settled transactions as a proxy for "service events."
    // When the front person is removed, their transactions get settled.
    // The intervals between consecutive settledAt timestamps approximate
    // how fast the line owner is processing people.
    const settledTransactions = await prisma.transaction.findMany({
      where: {
        lineId,
        settledAt: { not: null },
      },
      orderBy: { settledAt: "asc" },
      select: { settledAt: true },
    })

    // Deduplicate by taking unique settledAt timestamps (multiple transactions
    // can be settled at the same moment for the same person leaving)
    const uniqueSettledTimes: Date[] = []
    for (const tx of settledTransactions) {
      if (!tx.settledAt) continue
      const last = uniqueSettledTimes[uniqueSettledTimes.length - 1]
      // Consider timestamps within 5 seconds as the same "removal event"
      if (!last || Math.abs(tx.settledAt.getTime() - last.getTime()) > 5000) {
        uniqueSettledTimes.push(tx.settledAt)
      }
    }

    if (uniqueSettledTimes.length >= 2) {
      // Calculate average interval between service events
      const intervals: number[] = []
      for (let i = 1; i < uniqueSettledTimes.length; i++) {
        const gap = uniqueSettledTimes[i].getTime() - uniqueSettledTimes[i - 1].getTime()
        intervals.push(gap)
      }
      const avgIntervalMs = intervals.reduce((a, b) => a + b, 0) / intervals.length
      const avgIntervalMin = avgIntervalMs / 60000

      // Get current position count so the caller can multiply by position
      return NextResponse.json({
        estimatedMinutesPerPerson: Math.round(avgIntervalMin * 10) / 10,
        basedOn: uniqueSettledTimes.length,
      })
    }

    // Strategy 2: Fall back to joinedAt gaps of current positions.
    // If people are joining at a roughly steady rate and the line is moving,
    // the spacing between joinedAt times of remaining positions approximates
    // how quickly spots open up (since positions shift up on removal).
    const positions = await prisma.linePosition.findMany({
      where: { lineId },
      orderBy: { joinedAt: "asc" },
      select: { joinedAt: true },
    })

    if (positions.length >= 3) {
      // Use gaps between the first few people who joined as an estimate
      const intervals: number[] = []
      for (let i = 1; i < positions.length; i++) {
        const gap = positions[i].joinedAt.getTime() - positions[i - 1].joinedAt.getTime()
        intervals.push(gap)
      }
      const avgIntervalMs = intervals.reduce((a, b) => a + b, 0) / intervals.length
      const avgIntervalMin = avgIntervalMs / 60000

      return NextResponse.json({
        estimatedMinutesPerPerson: Math.round(avgIntervalMin * 10) / 10,
        basedOn: positions.length,
      })
    }

    // Not enough data to estimate
    return NextResponse.json({
      estimatedMinutesPerPerson: null,
      basedOn: Math.max(uniqueSettledTimes.length, positions.length),
    })
  } catch (error) {
    console.error("Wait time calculation error:", error)
    return NextResponse.json(
      { error: "Something went wrong while estimating wait time. Please try again." },
      { status: 500 }
    )
  }
}
