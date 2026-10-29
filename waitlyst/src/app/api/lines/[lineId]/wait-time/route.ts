import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { estimateMinutesPerPerson } from "@/lib/wait-time"

export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  try {
    const line = await prisma.line.findUnique({
      where: { id: lineId },
      select: { id: true },
    })
    if (!line) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 })
    }

    // Only real service events count. Join times were used before, but they
    // measure how fast people arrive, not how fast the line moves -- a drop
    // where 200 people join in a minute would promise #200 a one-minute wait.
    // Served people who are still in line, plus everyone served and since
    // cleared out (their position is gone but the visit is kept).
    const [fulfilledPositions, servedVisits] = await Promise.all([
      prisma.linePosition.findMany({
        where: { lineId, fulfilledAt: { not: null } },
        select: { fulfilledAt: true },
      }),
      prisma.queueVisit.findMany({
        where: { lineId, servedAt: { not: null } },
        select: { servedAt: true },
        orderBy: { servedAt: "desc" },
        take: 200,
      }),
    ])

    const timestamps = [
      ...fulfilledPositions.map((p) => p.fulfilledAt),
      ...servedVisits.map((v) => v.servedAt),
    ].filter((t): t is Date => t instanceof Date)

    const { minutes, basedOn } = estimateMinutesPerPerson(timestamps)

    return NextResponse.json({ estimatedMinutesPerPerson: minutes, basedOn })
  } catch (error) {
    console.error("Wait time calculation error:", error)
    return NextResponse.json(
      { error: "Something went wrong while estimating wait time. Please try again." },
      { status: 500 }
    )
  }
}
