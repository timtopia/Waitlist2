import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

const MAX_QUOTE_MINUTES = 240

/**
 * The host quotes a party their own wait ("about 25 minutes"), as hosts do
 * at the stand. It's shown to that party next to the app's estimate.
 * minutes: null clears it.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  const body = await req.json().catch(() => ({}))
  if (typeof body?.positionId !== "string") {
    return NextResponse.json({ error: "Position ID is required" }, { status: 400 })
  }
  const minutes = body.minutes
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_QUOTE_MINUTES)) {
    return NextResponse.json(
      { error: `A quote must be a whole number of minutes from 1 to ${MAX_QUOTE_MINUTES}` },
      { status: 400 }
    )
  }

  const { count } = await prisma.linePosition.updateMany({
    where: { id: body.positionId, lineId, fulfilled: false },
    data: minutes === null
      ? { quotedMinutes: null, quotedAt: null }
      : { quotedMinutes: minutes, quotedAt: new Date() },
  })
  if (count === 0) {
    return NextResponse.json({ error: "That party isn't waiting in this line any more" }, { status: 404 })
  }
  return NextResponse.json({ quotedMinutes: minutes })
}
