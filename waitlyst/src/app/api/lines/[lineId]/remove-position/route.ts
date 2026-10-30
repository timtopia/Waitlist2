import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { removeByOrganizer, PositionNotFoundError } from "@/lib/queue-exit"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const { positionId, action = "payout" } = await req.json()

  if (!positionId || typeof positionId !== "string") {
    return NextResponse.json({ error: "Position ID is required" }, { status: 400 })
  }

  if (!["payout", "refund"].includes(action)) {
    return NextResponse.json({ error: "Action must be 'payout' or 'refund'" }, { status: 400 })
  }

  const authResult = await requireLineOwner(lineId)
  if (authResult instanceof NextResponse) return authResult

  try {
    const result = await removeByOrganizer(lineId, positionId, action)

    return NextResponse.json({ success: true, action, ...result })
  } catch (error) {
    if (error instanceof PositionNotFoundError) {
      return NextResponse.json(
        { error: "Could not find this person. They may have already left the line." },
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
