import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { RESTAURANT_PACE_WINDOW_MS, estimateMinutesPerPerson } from "@/lib/wait-time"
import { rateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// Public and unauthenticated; same per-IP budget as the line page itself
// (a whole restaurant's guests can share one Wi-Fi address)
const limiter = rateLimit({ interval: 60_000, limit: 300 })

export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous"
  if (!limiter.check(ip).success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }
  const { lineId } = await params

  try {
    const line = await prisma.line.findUnique({
      where: { id: lineId },
      select: { id: true, kind: true },
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
        // A big drop can have thousands served and not yet cleared
        orderBy: { fulfilledAt: "desc" },
        take: 200,
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

    // A restaurant's pace is tonight's: guests were being promised a wait
    // from yesterday's (or last week's) sitting before anyone was seated today
    const since = line.kind === "RESTAURANT" ? new Date(Date.now() - RESTAURANT_PACE_WINDOW_MS) : null
    const { minutes, basedOn } = estimateMinutesPerPerson(timestamps, since)

    return NextResponse.json({ estimatedMinutesPerPerson: minutes, basedOn })
  } catch (error) {
    console.error("Wait time calculation error:", error)
    return NextResponse.json(
      { error: "Something went wrong while estimating wait time. Please try again." },
      { status: 500 }
    )
  }
}
