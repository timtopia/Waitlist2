import { NextResponse } from "next/server"
import { countCapacityUsed } from "@/lib/capacity-server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { lockLine } from "@/lib/queue-exit"
import { capacityUnit, parsePartySize } from "@/lib/capacity"

/** A reason the join was refused, safe to show the user. */
class JoinRefusedError extends Error {}

const limiter = rateLimit({ interval: 60_000, limit: 5 })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { success: allowed } = limiter.check(result.userId)
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  const { lineId } = await params
  const body = await req.json().catch(() => ({}))

  try {
    const position = await prisma.$transaction(async (tx) => {
      // Hold the line until this join commits so concurrent joins can't take
      // the same position or slip past the capacity check together.
      await lockLine(tx, lineId)

      // Check if line exists and is active
      const line = await tx.line.findUnique({ where: { id: lineId } })
      if (!line) {
        throw new JoinRefusedError("Line not found")
      }
      if (!line.isActive) {
        throw new JoinRefusedError("This line is paused. Try again when it reopens.")
      }

      // Check if line has opened yet
      if (line.opensAt && new Date() < new Date(line.opensAt)) {
        throw new JoinRefusedError("This line hasn't opened yet")
      }

      // Check if line has closed
      if (line.closesAt && new Date() > new Date(line.closesAt)) {
        throw new JoinRefusedError("This line is closed")
      }

      // Creator cannot join their own line
      if (line.createdById === result.userId) {
        throw new JoinRefusedError("You cannot join your own line")
      }

      // Check if already in line
      const existing = await tx.linePosition.findUnique({
        where: { lineId_userId: { lineId, userId: result.userId } },
      })
      if (existing) {
        throw new JoinRefusedError("Already in this line")
      }

      const partySize = parsePartySize(line.kind, body?.partySize)
      if (typeof partySize !== "number") {
        throw new JoinRefusedError(partySize.error)
      }

      // Capacity counts guests, so a party only fits if all of it does
      if (line.maxCapacity) {
        const taken = await countCapacityUsed(line, tx)
        if (taken >= line.maxCapacity) {
          throw new JoinRefusedError("This line is full")
        }
        if (taken + partySize > line.maxCapacity) {
          const left = line.maxCapacity - taken
          throw new JoinRefusedError(
            `There's only room for ${left} more ${capacityUnit(line.kind, left)} in this line`
          )
        }
      }

      // Get next position number
      const lastPosition = await tx.linePosition.findFirst({
        where: { lineId },
        orderBy: { position: "desc" },
      })
      const nextPosition = (lastPosition?.position ?? 0) + 1

      // Create position
      return tx.linePosition.create({
        data: {
          lineId,
          userId: result.userId,
          position: nextPosition,
          partySize,
        },
        include: {
          user: { select: { id: true, name: true, image: true } },
        },
      })
    })

    return NextResponse.json(position)
  } catch (error) {
    if (error instanceof JoinRefusedError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("Join line error:", error)
    return NextResponse.json(
      { error: "Could not join this line. Please try again." },
      { status: 500 }
    )
  }
}
