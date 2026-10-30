import { NextResponse } from "next/server"
import { runAfterResponse } from "@/lib/after-response"
import { prisma } from "@/lib/prisma"
import { requireLineOwner } from "@/lib/auth-helpers"
import { expireCheckoutSession, getBaseUrl, returnBuyerFunds } from "@/lib/stripe"
import { getPlatformFeePercent } from "@/lib/fees"
import { rateLimit } from "@/lib/rate-limit"
import { capacityUsed, capacityView } from "@/lib/capacity"
import { auth } from "@/auth"
import { lineViewer, shortName } from "@/lib/privacy"
import { createHash } from "crypto"
import { sendEmail } from "@/lib/email"
import { lineDeletedEmail } from "@/lib/email-templates"

const getLimiter = rateLimit({ interval: 60_000, limit: 60 })

export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous"
  const { success: allowed } = getLimiter.check(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  const { lineId } = await params

  try {
    const session = await auth()
    const viewerId = session?.user?.id ?? null

    // Pollers send back the ETag they last saw. Anything that changes the
    // response bumps the line's or a position's updatedAt (or the count, for
    // the last person leaving), so this cheap check lets an unchanged line
    // skip loading every position.
    const [head, positionStats] = await Promise.all([
      prisma.line.findUnique({ where: { id: lineId }, select: { updatedAt: true, createdById: true } }),
      prisma.linePosition.aggregate({ where: { lineId }, _max: { updatedAt: true }, _count: true }),
    ])
    if (!head) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 })
    }
    const viewer = await lineViewer(lineId, head.createdById, viewerId)
    const etag = `"${createHash("sha1").update([
      head.updatedAt.getTime(),
      positionStats._max.updatedAt?.getTime() ?? 0,
      positionStats._count,
      viewer, // owners, members and the public each see different detail
      getPlatformFeePercent(),
    ].join("|")).digest("base64url")}"`
    const cacheHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate", ETag: etag }
    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: cacheHeaders })
    }

    const line = await prisma.line.findUnique({
      where: { id: lineId },
      include: {
        createdBy: { select: { id: true, name: true, image: true } },
        positions: {
          include: { user: { select: { id: true, name: true, image: true } } },
          orderBy: { position: "asc" },
        },
      },
    })

    if (!line) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 })
    }

    const servedAndCleared = line.kind === "RESTAURANT"
      ? 0
      : await prisma.queueVisit.count({ where: { lineId, outcome: "SERVED" } })
    const capacity = capacityView(line, capacityUsed(line.kind, line.positions, servedAndCleared), viewerId)

    // The owner sees full names. People in the line see each other as
    // "First L.". Anyone else sees the queue's shape but not who is in it.
    const positions = viewer === "owner"
      ? line.positions
      : line.positions.map((p) => {
          if (p.userId === viewerId) return p
          if (viewer === "member") return { ...p, user: { ...p.user, name: shortName(p.user.name) } }
          return {
            ...p,
            userId: `anon-${p.id}`,
            lockedBy: null,
            user: { id: `anon-${p.id}`, name: null, image: null },
          }
        })

    return NextResponse.json({ ...line, positions, ...capacity, platformFeePercent: getPlatformFeePercent() }, {
      headers: cacheHeaders,
    })
  } catch (error) {
    console.error("Get line error:", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
    // Who to tell, read before their positions disappear with the line
    const members = await prisma.linePosition.findMany({
      where: { lineId },
      select: { user: { select: { id: true, name: true, email: true, emailNotifications: true } } },
    })

    // Get unsettled transactions to refund
    const { transactionsToRefund, abandonedSessions } = await prisma.$transaction(async (tx) => {
      // Fail any pending transactions
      const pending = await tx.transaction.findMany({
        where: { lineId, status: "PENDING" },
        select: { stripePaymentId: true },
      })
      await tx.transaction.updateMany({
        where: { lineId, status: "PENDING" },
        data: { status: "FAILED" },
      })

      // Find unsettled COMPLETED transactions that need refunding
      const transactionsToRefund = await tx.transaction.findMany({
        where: { lineId, status: "COMPLETED", settledAt: null },
      })
      return { transactionsToRefund, abandonedSessions: pending.map((t) => t.stripePaymentId) }
    })

    // Someone still on a payment page must not be able to pay for a spot in
    // a line that no longer exists.
    await Promise.all(abandonedSessions.map((id) => expireCheckoutSession(id)))

    // Release uncaptured holds (no fees), refund anything already captured.
    const refundedCount = (await returnBuyerFunds(transactionsToRefund)).length
    const refundFailedCount = transactionsToRefund.length - refundedCount
    if (refundFailedCount > 0) {
      console.error(`Delete line ${lineId}: ${refundFailedCount} refund(s) failed; left unsettled for follow-up`)
    }

    // Close out what was refunded. A purchase Stripe wouldn't refund stays
    // unsettled, so it isn't recorded as handled when the buyer still paid.
    await prisma.$transaction(async (tx) => {
      await tx.transaction.updateMany({
        where: { lineId, settledAt: null, status: "REFUNDED" },
        data: { settledAt: new Date() },
      })
      // Offers aren't tied to the line by a foreign key, so clear them here.
      await tx.swapOffer.deleteMany({ where: { lineId } })
      await tx.line.delete({ where: { id: lineId } })
    })

    const buyers = new Set(transactionsToRefund.map((t) => t.buyerId))
    const browseUrl = `${getBaseUrl()}/browse`
    for (const { user } of members) {
      if (!user.email || !user.emailNotifications) continue
      const { subject, html } = lineDeletedEmail(user.name || "there", result.line.name, buyers.has(user.id), browseUrl)
      runAfterResponse(() => sendEmail(user.email!, subject, html))
    }

    return NextResponse.json({ success: true, refundedCount, refundFailedCount })
  } catch (error) {
    console.error("Delete line error:", error)
    const message = error instanceof Error ? error.message : "Something went wrong. Please try again."
    const status = message === "Line not found" ? 404 : message === "Not authorized" ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
