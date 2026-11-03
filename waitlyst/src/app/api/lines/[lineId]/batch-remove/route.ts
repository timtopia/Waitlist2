import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { removeByOrganizer, PositionNotFoundError } from "@/lib/queue-exit"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }
  const { positionIds, action = "payout" } = body
  // The host closed for the night: guests are told that, not "removed"
  const closing = body.reason === "closed"

  if (!Array.isArray(positionIds) || positionIds.length === 0) {
    return NextResponse.json(
      { error: "positionIds must be a non-empty array" },
      { status: 400 }
    )
  }
  // Each removal may refund or collect through Stripe one after another; an
  // unbounded list would time out halfway and leave the line half-settled
  if (positionIds.length > 500 || !positionIds.every((id) => typeof id === "string")) {
    return NextResponse.json(
      { error: "positionIds must be at most 500 position IDs" },
      { status: 400 }
    )
  }

  if (!["payout", "refund"].includes(action)) {
    return NextResponse.json(
      { error: "Action must be 'payout' or 'refund'" },
      { status: 400 }
    )
  }

  const authResult = await requireLineOwner(lineId)
  if (authResult instanceof NextResponse) return authResult

  let removed = 0
  let failed = 0
  // Removed by another device or the guest in the meantime: not a failure
  let alreadyGone = 0
  let refundedCount = 0
  let refundedAmount = 0
  let refundFailedCount = 0
  let collectFailedCount = 0

  for (const positionId of positionIds) {
    try {
      const result = await removeByOrganizer(lineId, positionId, action, false, false, closing)
      removed++
      refundedCount += result.refundedCount
      refundedAmount += result.refundedAmount
      refundFailedCount += result.refundFailedCount
      collectFailedCount += result.collectFailedCount
    } catch (e) {
      if (e instanceof PositionNotFoundError) alreadyGone++
      else failed++
    }
  }

  return NextResponse.json({ removed, failed, alreadyGone, refundedCount, refundedAmount, refundFailedCount, collectFailedCount })
}
