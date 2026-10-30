import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { removeByOrganizer } from "@/lib/queue-exit"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const { positionIds, action = "payout" } = await req.json()

  if (!Array.isArray(positionIds) || positionIds.length === 0) {
    return NextResponse.json(
      { error: "positionIds must be a non-empty array" },
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
  let refundedCount = 0
  let refundedAmount = 0
  let refundFailedCount = 0
  let collectFailedCount = 0

  for (const positionId of positionIds) {
    try {
      const result = await removeByOrganizer(lineId, positionId, action)
      removed++
      refundedCount += result.refundedCount
      refundedAmount += result.refundedAmount
      refundFailedCount += result.refundFailedCount
      collectFailedCount += result.collectFailedCount
    } catch {
      failed++
    }
  }

  return NextResponse.json({ removed, failed, refundedCount, refundedAmount, refundFailedCount, collectFailedCount })
}
