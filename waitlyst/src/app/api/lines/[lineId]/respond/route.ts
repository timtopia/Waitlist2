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
      line: { select: { responseWindowMinutes: true, isActive: true } },
    },
  })
  if (!position) {
    return NextResponse.json({ error: "You haven't been called in this line" }, { status: 400 })
  }

  // Too late to answer once the time to show up has run out; the next
  // sweep skips them, and a reply mustn't win their place back.
  const now = new Date()
  const { responseWindowMinutes, isActive } = position.line
  if (
    responseWindowMinutes &&
    isActive &&
    responseDeadline(position.calledAt!, responseWindowMinutes, position.respondedAt, position.graceMinutes ?? 0) <= now
  ) {
    return NextResponse.json({ error: "Your time to show up has run out" }, { status: 409 })
  }

  // respondedAt marks the first "on my way" for this call: the one extension
  // it buys is kept if they later say they're running late, and saying it
  // again doesn't buy more.
  await prisma.linePosition.update({
    where: { id: position.id },
    data: {
      response: body.response,
      ...(body.response === "ON_MY_WAY" && !position.respondedAt ? { respondedAt: now } : {}),
    },
  })
  return NextResponse.json({ response: body.response })
}
