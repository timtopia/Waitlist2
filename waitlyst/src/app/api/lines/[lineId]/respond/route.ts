import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

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

  const { count } = await prisma.linePosition.updateMany({
    where: { lineId, userId: result.userId, fulfilled: false, calledAt: { not: null } },
    data: { response: body.response, respondedAt: new Date() },
  })
  if (count === 0) {
    return NextResponse.json({ error: "You haven't been called in this line" }, { status: 400 })
  }
  return NextResponse.json({ response: body.response })
}
