import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { setLineActive } from "@/lib/line-pause"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  // Callers say which state they want. Flipping whatever is stored meant a
  // double-click, or the owner on two devices, could land on the opposite
  // of what they asked for. A body without isActive still toggles.
  const body = await req.json().catch(() => ({}))
  const isActive = typeof body?.isActive === "boolean" ? body.isActive : !result.line.isActive

  try {
    await setLineActive(lineId, isActive)
    return NextResponse.json({ isActive })
  } catch (error) {
    console.error("Pause toggle error:", error)
    return NextResponse.json(
      { error: "Something went wrong while updating the line status. Please try again." },
      { status: 500 }
    )
  }
}
