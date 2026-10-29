import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { positionCalledEmail } from "@/lib/email-templates"
import { abandonPendingTransaction } from "@/lib/stripe"

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

    // Once called, this spot is at the counter and stops being tradeable.
    // A swap still on the payment page would push them back after they were
    // called, so it's called off (the buyer's hold is released).
    if (frontPosition.lockedBy && frontPosition.lockedUntil && frontPosition.lockedUntil > new Date()) {
      await abandonPendingTransaction(frontPosition.lockedBy)
    }

    const calledAt = new Date()
    const [line] = await prisma.$transaction([
      prisma.line.update({
        where: { id: lineId },
        data: {
          announcement: `\u{1F4E2} ${userName}, you're up! Please come forward.`,
          announcementAt: calledAt,
          nowServing: userName,
          nowServingUserId: frontPosition.userId,
          nowServingAt: calledAt,
        },
      }),
      prisma.linePosition.update({
        where: { id: frontPosition.id },
        data: { calledAt, askingPrice: null },
      }),
      prisma.swapOffer.updateMany({
        where: {
          lineId,
          status: "PENDING",
          OR: [{ fromUserId: frontPosition.userId }, { toUserId: frontPosition.userId }],
        },
        data: { status: "EXPIRED" },
      }),
    ])

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
      calledUserId: frontPosition.userId,
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
