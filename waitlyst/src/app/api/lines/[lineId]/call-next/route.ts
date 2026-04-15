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
    // Find the front person (position 1)
    const frontPosition = await prisma.linePosition.findFirst({
      where: { lineId, position: 1 },
      include: { user: { select: { name: true, email: true, emailNotifications: true } } },
    })

    if (!frontPosition) {
      return NextResponse.json(
        { error: "No one in line to call" },
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
      position: 1,
    })
  } catch (error) {
    console.error("Call next error:", error)
    return NextResponse.json(
      { error: "Something went wrong while calling the next person. Please try again." },
      { status: 500 }
    )
  }
}
