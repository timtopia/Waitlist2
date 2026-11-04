import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { responseDeadline } from "@/lib/missed-calls"

/**
 * A called person tells the host they're on their way, or running late, so
 * the host doesn't give their table or turn away to someone else too early.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const { lineId } = await params

  const body = await req.json().catch(() => ({}))
  if (body?.response !== "ON_MY_WAY" && body?.response !== "RUNNING_LATE") {
    return NextResponse.json({ error: "Response must be ON_MY_WAY or RUNNING_LATE" }, { status: 400 })
  }

  const position = await prisma.linePosition.findFirst({
    where: { lineId, userId: result.userId, fulfilled: false, calledAt: { not: null } },
    select: {
      id: true,
      calledAt: true,
      respondedAt: true,
      graceMinutes: true,
      line: { select: { responseWindowMinutes: true, isActive: true, pausedAt: true } },
    },
  })
  if (!position) {
    return NextResponse.json({ error: "You haven't been called in this line" }, { status: 400 })
  }

  // Too late to answer once the time to show up has run out; the next
  // sweep skips them, and a reply mustn't win their place back.
  const now = new Date()
  const { responseWindowMinutes, isActive, pausedAt } = position.line
  // A pause freezes the clock where it stood: someone whose time had already
  // run out before the pause (the sweep just hadn't run) can't answer then
  // and have resume hand them a fresh window.
  const clock = !isActive && pausedAt ? pausedAt : isActive ? now : null
  if (
    responseWindowMinutes &&
    clock &&
    responseDeadline(position.calledAt!, responseWindowMinutes, position.respondedAt, position.graceMinutes ?? 0) <= clock
  ) {
    return NextResponse.json({ error: "Your time to show up has run out" }, { status: 409 })
  }

  // respondedAt marks the first "on my way" for this call: the one extension
  // it buys is kept if they later say they're running late, and saying it
  // again doesn't buy more.
  // Conditional on the same call: the host may have seated or removed them,
  // or called them again, since we read the row.
  const updated = await prisma.linePosition.updateMany({
    where: { id: position.id, fulfilled: false, calledAt: position.calledAt },
    data: {
      response: body.response,
      ...(body.response === "ON_MY_WAY" && !position.respondedAt ? { respondedAt: now } : {}),
    },
  })
  if (updated.count === 0) {
    return NextResponse.json(
      { error: "You're no longer waiting on that call. Refresh to see where you stand." },
      { status: 409 }
    )
  }
  // Whether this tap bought the one extension: a repeat "on my way" doesn't,
  // so the guest isn't promised time that never shows up on their countdown
  const extended = body.response === "ON_MY_WAY" && !position.respondedAt && !!responseWindowMinutes
  // The window restarts from this tap, so it adds only as long as they took
  // to answer: tapping straight from the email adds seconds, not minutes
  // While paused, resume moves the tap back to the pause: only the time up to
  // the pause counts, not the paused minutes
  const answeredAt = !isActive && pausedAt ? pausedAt : now
  const extendedMinutes = extended ? Math.max(0, Math.floor((answeredAt.getTime() - position.calledAt!.getTime()) / 60_000)) : 0
  return NextResponse.json({ response: body.response, extended: extendedMinutes >= 1, extendedMinutes })
}
