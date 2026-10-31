import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

/** Whether the signed-in viewer asked to be emailed when this line opens. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const { lineId } = await params

  const reminder = await prisma.lineReminder.findUnique({
    where: { lineId_userId: { lineId, userId: result.userId } },
    select: { sentAt: true },
  })
  return NextResponse.json({ subscribed: !!reminder && !reminder.sentAt })
}

/** Email me when this line opens. Only for lines scheduled to open later. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const { lineId } = await params

  const line = await prisma.line.findUnique({
    where: { id: lineId },
    select: { opensAt: true, createdById: true },
  })
  if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 })
  if (line.createdById === result.userId) {
    return NextResponse.json({ error: "This is your own line" }, { status: 400 })
  }
  if (!line.opensAt || line.opensAt <= new Date()) {
    return NextResponse.json({ error: "This line is already open" }, { status: 400 })
  }

  await prisma.lineReminder.upsert({
    where: { lineId_userId: { lineId, userId: result.userId } },
    create: { lineId, userId: result.userId },
    update: { sentAt: null },
  })
  return NextResponse.json({ subscribed: true })
}

/** Stop the reminder. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const { lineId } = await params

  await prisma.lineReminder.deleteMany({ where: { lineId, userId: result.userId } })
  return NextResponse.json({ subscribed: false })
}
