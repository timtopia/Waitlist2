import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
    // Find the front person (position 1)
    const frontPosition = await prisma.linePosition.findFirst({
      where: { lineId, position: 1 },
      include: { user: { select: { name: true } } },
    })

    if (!frontPosition) {
      return NextResponse.json(
        { error: "No one in line to call" },
        { status: 400 }
      )
    }

    const userName = frontPosition.user?.name || "Next person"

    // Update the line's announcement to notify the front person
    await prisma.line.update({
      where: { id: lineId },
      data: {
        announcement: `\u{1F4E2} ${userName}, you're up! Please come forward.`,
        announcementAt: new Date(),
      },
    })

    return NextResponse.json({
      calledUser: userName,
      position: 1,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to call next person"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
