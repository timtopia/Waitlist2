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
      { error: `They've already had ${position.graceMinutes} extra minutes. Call them again to restart their time.` },
      { status: 400 }
    )
  }

  const updated = await prisma.linePosition.update({
    where: { id: position.id },
    data: { graceMinutes: { increment: GRACE_STEP_MINUTES } },
    select: { graceMinutes: true },
  })
  return NextResponse.json({ graceMinutes: updated.graceMinutes })
}
