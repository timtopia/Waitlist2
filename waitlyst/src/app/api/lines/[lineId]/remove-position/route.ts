import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { removeByOrganizer, PositionNotFoundError } from "@/lib/queue-exit"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }
  const { positionId, action = "payout", noShow = false } = body
  // The call the host was looking at when they chose No-show. Another device
  // may have re-called them, given more time or seated them since; a no-show
  // from that stale view would remove a party who's walking in.
  const seenCalledAt = typeof body.calledAt === "string" ? body.calledAt : null
  const seenGrace = typeof body.graceMinutes === "number" ? body.graceMinutes : 0
  // Their reply as the host saw it: an "on my way" sent while the dialog was
  // open means they're walking in. Older clients don't send it.
  const seenResponse =
    "response" in body && (body.response === null || body.response === "ON_MY_WAY" || body.response === "RUNNING_LATE")
      ? (body.response as string | null)
      : undefined

  if (!positionId || typeof positionId !== "string") {
    return NextResponse.json({ error: "Position ID is required" }, { status: 400 })
  }

  if (!["payout", "refund"].includes(action)) {
    return NextResponse.json({ error: "Action must be 'payout' or 'refund'" }, { status: 400 })
  }

  const authResult = await requireLineOwner(lineId)
  if (authResult instanceof NextResponse) return authResult

  try {
    // A no-show keeps their purchases: the people they bought from gave up
    // their places, the same as when someone leaves.
    const result = await removeByOrganizer(
      lineId,
      positionId,
      noShow === true ? "payout" : action,
      noShow === true,
      false,
      false,
      noShow === true && seenCalledAt
        ? (c) => !c.fulfilled && c.calledAt?.toISOString() === seenCalledAt && (c.graceMinutes ?? 0) === seenGrace &&
            (seenResponse === undefined || (c.response ?? null) === seenResponse)
        : undefined
    )

    return NextResponse.json({ success: true, action, ...result })
  } catch (error) {
    if (error instanceof PositionNotFoundError) {
      const stillThere = await prisma.linePosition.findUnique({ where: { id: positionId, lineId }, select: { id: true } })
      if (stillThere) {
        return NextResponse.json(
          { error: "They were just called again, given more time, seated on another device or said they're on the way, so they weren't marked as a no-show." },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: "They're no longer in this line -- they may have already left." },
        { status: 404 }
      )
    }
    console.error("Remove position error:", error)
    return NextResponse.json(
      { error: "Could not remove this person. Please try again." },
      { status: 500 }
    )
  }
}
