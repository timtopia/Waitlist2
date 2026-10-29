import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { positionCalledEmail } from "@/lib/email-templates"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
    // Served (fulfilled) people stay in the line until cleared, so "next" is
    // the first person who hasn't been served yet -- not simply position 1.
    const frontPosition = await prisma.linePosition.findFirst({
      where: { lineId, fulfilled: false },
      orderBy: { position: "asc" },
      include: { user: { select: { name: true, email: true, emailNotifications: true } } },
    })

    if (!frontPosition) {
      const inLine = await prisma.linePosition.count({ where: { lineId } })
      return NextResponse.json(
        { error: inLine > 0 ? "Everyone in line has already been served" : "No one in line to call" },
        { status: 400 }
      )
    }

    const userName = frontPosition.user?.name || "Next person"

    // Update the line's announcement and now-serving display
    const line = await prisma.line.update({
      where: { id: lineId },
      data: {
        announcement: `\u{1F4E2} ${userName}, you're up! Please come forward.`,
        announcementAt: new Date(),
        nowServing: userName,
        nowServingAt: new Date(),
      },
    })

    // Send email notification (fire-and-forget)
    const calledUser = frontPosition.user
    if (calledUser?.email && calledUser.emailNotifications) {
      const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000"
      const lineUrl = `${baseUrl}/lines/${lineId}`
      const { subject, html } = positionCalledEmail(userName, line.name, lineUrl)
      sendEmail(calledUser.email, subject, html).catch(() => {})
    }

    return NextResponse.json({
      calledUser: userName,
      position: frontPosition.position,
      positionId: frontPosition.id,
    })
  } catch (error) {
    console.error("Call next error:", error)
    return NextResponse.json(
      { error: "Something went wrong while calling the next person. Please try again." },
      { status: 500 }
    )
  }
}
