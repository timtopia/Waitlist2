import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

const GRACE_STEP_MINUTES = 5
const MAX_GRACE_MINUTES = 60

/**
 * The host gives a called party more time to show up -- they said they're
 * running late and the table can wait. Unlike "Call again" it doesn't clear
 * their reply or send another "you've been called".
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

  const position = await prisma.linePosition.findFirst({
    where: { id: body.positionId, lineId, fulfilled: false, calledAt: { not: null } },
    select: { id: true, graceMinutes: true },
  })
  if (!position) {
    return NextResponse.json({ error: "That party isn't waiting on a call any more" }, { status: 404 })
  }
  if (position.graceMinutes + GRACE_STEP_MINUTES > MAX_GRACE_MINUTES) {
    return NextResponse.json(
      {
        // Only restaurant lists have a per-row Call again
        error: result.line.kind === "RESTAURANT"
          ? `They've already had ${position.graceMinutes} extra minutes. Use Call again on their row in the list to restart their time.`
          : `They've already had ${position.graceMinutes} extra minutes, the most allowed. Mark them served, or as a no-show if they aren't coming.`,
      },
      { status: 400 }
    )
  }

  // Conditional on the value we checked, so two devices tapping at once
  // can't both add time (or push past the cap).
  const updated = await prisma.linePosition.updateMany({
    where: { id: position.id, fulfilled: false, graceMinutes: position.graceMinutes },
    data: { graceMinutes: { increment: GRACE_STEP_MINUTES } },
  })
  if (updated.count === 0) {
    return NextResponse.json(
      { error: "Someone just changed their time (maybe from another device). The list has been updated." },
      { status: 409 }
    )
  }
  return NextResponse.json({ graceMinutes: position.graceMinutes + GRACE_STEP_MINUTES })
}
