import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { lockLine } from "@/lib/queue-exit"
import { capacityUnit, parsePartySize } from "@/lib/capacity"
import { countCapacityUsed } from "@/lib/capacity-server"
import { cleanDisplayName, parseNote } from "@/lib/validate"
import { hostActionLimiter } from "@/lib/rate-limit"

/** A reason the walk-in couldn't be added, safe to show the owner. */
class WalkInRefusedError extends Error {}

/**
 * The host adds someone at the stand who has no account (or no phone). They
 * get a real place in the queue, held by a stand-in user that can't sign in,
 * trade or be emailed. Capacity and the line lock work as for any join.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  // Each walk-in is a stand-in account: keep a script from minting thousands
  if (!hostActionLimiter().check(`walk-in:${result.userId}`).success) {
    return NextResponse.json(
      { error: "Too many walk-ins at once. Please wait a minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  const body = await req.json().catch(() => ({}))
  const name = cleanDisplayName(body?.name)
  if (typeof name !== "string") return NextResponse.json({ error: name.error }, { status: 400 })

  try {
    const position = await prisma.$transaction(async (tx) => {
      await lockLine(tx, lineId)
      const line = await tx.line.findUnique({ where: { id: lineId } })
      if (!line) throw new WalkInRefusedError("Line not found")

      const partySize = parsePartySize(line.kind, body?.partySize)
      if (typeof partySize !== "number") throw new WalkInRefusedError(partySize.error)
      const note = line.kind === "RESTAURANT" ? parseNote(body?.note) : null
      if (note && typeof note === "object") throw new WalkInRefusedError(note.error)

      // A reply lost on venue Wi-Fi reads as a failure while the name is still
      // in the form, so the host taps Add again: hand back the party just
      // added instead of seating them twice
      const [recent] = (await tx.linePosition.findMany({
        where: {
          lineId,
          fulfilled: false,
          partySize,
          note,
          joinedAt: { gte: new Date(Date.now() - 60_000) },
          user: { isWalkIn: true, name },
        },
        orderBy: { position: "desc" },
        take: 1,
      })) ?? []
      if (recent) {
        const ahead = await tx.linePosition.count({
          where: { lineId, fulfilled: false, position: { lt: recent.position } },
        })
        return { ...recent, ahead }
      }

      if (line.maxCapacity) {
        const left = line.maxCapacity - await countCapacityUsed(line, tx)
        if (partySize > left) {
          throw new WalkInRefusedError(
            left > 0
              ? `There's only room for ${left} more ${capacityUnit(line.kind, left)} in this line`
              : "This line is full"
          )
        }
      }

      const guest = await tx.user.create({ data: { name, isWalkIn: true } })
      const last = await tx.linePosition.findFirst({ where: { lineId }, orderBy: { position: "desc" } })
      const created = await tx.linePosition.create({
        data: {
          lineId,
          userId: guest.id,
          position: (last?.position ?? 0) + 1,
          partySize,
          note,
        },
      })
      // Who's still waiting ahead, counted under the lock: the host's screen
      // may be a poll behind another tablet's walk-ins
      const ahead = await tx.linePosition.count({
        where: { lineId, fulfilled: false, position: { lt: created.position } },
      })
      return { ...created, ahead }
    })

    return NextResponse.json(position)
  } catch (error) {
    if (error instanceof WalkInRefusedError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("Add walk-in error:", error)
    return NextResponse.json({ error: "Could not add the walk-in. Please try again." }, { status: 500 })
  }
}
