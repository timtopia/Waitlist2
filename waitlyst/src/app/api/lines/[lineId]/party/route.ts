import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { lockLine } from "@/lib/queue-exit"
import { capacityUnit, parsePartySize } from "@/lib/capacity"

/** A reason the change was refused, safe to show the user. */
class PartyRefusedError extends Error {}

/**
 * Change your party size while you wait (someone dropped out, or a friend is
 * joining you). Restaurant lines only; capacity is re-checked in guests.
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

      const mine = await tx.linePosition.findUnique({
        where: { lineId_userId: { lineId, userId: result.userId } },
      })
      if (!mine) throw new PartyRefusedError("You're not in this line")
      if (mine.fulfilled) throw new PartyRefusedError("You've already been seated")

      if (line.maxCapacity && partySize > mine.partySize) {
        const { _sum } = await tx.linePosition.aggregate({
          where: { lineId },
          _sum: { partySize: true },
        })
        const left = line.maxCapacity - (_sum.partySize ?? 0)
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
