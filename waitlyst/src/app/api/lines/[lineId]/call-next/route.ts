import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { positionCalledEmail, youreNextEmail } from "@/lib/email-templates"
import { abandonPendingTransaction } from "@/lib/stripe"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  // A restaurant host seats whichever party fits the free table, so they may
  // name who to call. Everywhere else it's strictly the front of the line.
  const body = await req.json().catch(() => ({}))
  const requestedId: unknown = body?.positionId
  if (requestedId !== undefined && typeof requestedId !== "string") {
    return NextResponse.json({ error: "Position ID must be a string" }, { status: 400 })
  }

  try {
    // Served (fulfilled) people stay in the line until cleared, so "next" is
    // the first person who hasn't been served yet -- not simply position 1.
    const firstUnserved = await prisma.linePosition.findFirst({
      where: { lineId, fulfilled: false },
      orderBy: { position: "asc" },
      include: { user: { select: { name: true, email: true, emailNotifications: true } } },
    })

    let frontPosition = firstUnserved
    if (requestedId && requestedId !== firstUnserved?.id) {
      if (result.line.kind !== "RESTAURANT") {
        return NextResponse.json(
          { error: "Only restaurant lines can call people out of order" },
          { status: 400 }
        )
      }
      frontPosition = await prisma.linePosition.findFirst({
        where: { id: requestedId, lineId, fulfilled: false },
        include: { user: { select: { name: true, email: true, emailNotifications: true } } },
      })
      if (!frontPosition) {
        return NextResponse.json(
          { error: "That party isn't waiting in this line any more" },
          { status: 404 }
        )
      }
    }

    if (!frontPosition) {
      const inLine = await prisma.linePosition.count({ where: { lineId } })
      return NextResponse.json(
        { error: inLine > 0 ? "Everyone in line has already been served" : "No one in line to call" },
        { status: 400 }
      )
    }

    const userName = frontPosition.user?.name || "Next person"
    const servingLabel = result.line.kind === "RESTAURANT"
      ? `${userName} (party of ${frontPosition.partySize})`
      : userName

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
          nowServing: servingLabel,
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

    // Send email notifications (fire-and-forget)
    const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000"
    const lineUrl = `${baseUrl}/lines/${lineId}`
    const calledUser = frontPosition.user
    if (calledUser?.email && calledUser.emailNotifications) {
      const { subject, html } = positionCalledEmail(userName, line.name, lineUrl)
      sendEmail(calledUser.email, subject, html).catch(() => {})
    }

    // Give whoever is now on deck a heads-up, but only the first time the
    // person ahead is called -- re-calling them shouldn't email again. A party
    // called out of order doesn't change who's on deck.
    if (!frontPosition.calledAt && frontPosition.id === firstUnserved?.id) {
      const onDeck = await prisma.linePosition.findFirst({
        where: { lineId, fulfilled: false, position: { gt: frontPosition.position } },
        orderBy: { position: "asc" },
        include: { user: { select: { name: true, email: true, emailNotifications: true } } },
      })
      if (onDeck?.user.email && onDeck.user.emailNotifications) {
        const { subject, html } = youreNextEmail(onDeck.user.name || "there", line.name, lineUrl)
        sendEmail(onDeck.user.email, subject, html).catch(() => {})
      }
    }

    return NextResponse.json({
      calledUser: userName,
      partySize: frontPosition.partySize,
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
