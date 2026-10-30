import { NextResponse } from "next/server"
import { countCapacityUsed } from "@/lib/capacity-server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { lockLine } from "@/lib/queue-exit"
import { capacityUnit, parsePartySize } from "@/lib/capacity"

/** A reason the change was refused, safe to show the user. */
class PartyRefusedError extends Error {}

/**
 * Change a party size. Guests change their own while they wait (someone
 * dropped out, or a friend is joining); capacity is re-checked in guests and
 * the size locks once they're called. The host can change any party's size
 * (pass positionId) at any point before seating -- "we're actually five" at
 * the stand -- and decides for themselves whether the room has space.
 * Restaurant lines only.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { lineId } = await params
  const body = await req.json().catch(() => ({}))

  try {
    const position = await prisma.$transaction(async (tx) => {
      // Same lock as joins, so a party growing and a newcomer joining can't
      // both squeeze into the last few seats.
      await lockLine(tx, lineId)

      const line = await tx.line.findUnique({ where: { id: lineId } })
      if (!line) throw new PartyRefusedError("Line not found")
      if (line.kind !== "RESTAURANT") {
        throw new PartyRefusedError("This line doesn't take party sizes")
      }

      const partySize = parsePartySize(line.kind, body?.partySize)
      if (typeof partySize !== "number") throw new PartyRefusedError(partySize.error)

      const byHost = typeof body?.positionId === "string"
      if (byHost && line.createdById !== result.userId) {
        throw new PartyRefusedError("Only the host can change another party's size")
      }
      const mine = byHost
        ? await tx.linePosition.findUnique({ where: { id: body.positionId, lineId } })
        : await tx.linePosition.findUnique({
            where: { lineId_userId: { lineId, userId: result.userId } },
          })
      if (!mine) throw new PartyRefusedError(byHost ? "That party isn't in this line any more" : "You're not in this line")
      if (mine.fulfilled) {
        throw new PartyRefusedError(byHost ? "That party has already been seated" : "You've already been seated")
      }
      // The host picked this party for a table at this size
      if (mine.calledAt && !byHost) {
        throw new PartyRefusedError("You've been called, so ask the host if your party size changed")
      }

      if (!byHost && line.maxCapacity && partySize > mine.partySize) {
        const left = line.maxCapacity - await countCapacityUsed(line, tx)
        if (partySize - mine.partySize > left) {
          throw new PartyRefusedError(
            left > 0
              ? `There's only room for ${left} more ${capacityUnit(line.kind, left)} in this line`
              : "This line is full, so your party can't grow"
          )
        }
      }

      return tx.linePosition.update({
        where: { id: mine.id },
        data: { partySize },
      })
    })

    return NextResponse.json({ partySize: position.partySize })
  } catch (error) {
    if (error instanceof PartyRefusedError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("Update party size error:", error)
    return NextResponse.json(
      { error: "Could not update your party size. Please try again." },
      { status: 500 }
    )
  }
}
