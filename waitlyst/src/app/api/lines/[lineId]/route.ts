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
import { expireMissedCalls } from "@/lib/missed-calls"
import { setLineActive } from "@/lib/line-pause"
import { sendDueLineReminders } from "@/lib/line-reminders"
import { createHash } from "crypto"
import { emailEnabled, sendEmail } from "@/lib/email"
import { lineDeletedEmail } from "@/lib/email-templates"

// Per signed-in viewer, else per IP: a venue's guests often share one Wi-Fi
// address (and drop crowds a carrier's), and 50 phones polling every 10s
// used up a shared IP budget -- locking out every guest and the host's tablet
const getLimiter = rateLimit({ interval: 60_000, limit: 300 })

/** Only check for unsent "it's open" emails this long after a line opens */
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000

export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous"
  let viewerId: string | null = null
  try {
    viewerId = (await auth())?.user?.id ?? null
  } catch {
    // Treated as signed out
  }
  const { success: allowed } = getLimiter.check(viewerId ? `u:${viewerId}` : `ip:${ip}`)
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  const { lineId } = await params

  try {
    // Pollers send back the ETag they last saw. Anything that changes the
    // response bumps the line's or a position's updatedAt (or the count, for
    // the last person leaving), so this cheap check lets an unchanged line
    // skip loading every position.
    const positionStatsQuery = () =>
      prisma.linePosition.aggregate({ where: { lineId }, _max: { updatedAt: true }, _count: true })
    const [head, initialStats] = await Promise.all([
      prisma.line.findUnique({
        where: { id: lineId },
        select: { updatedAt: true, createdById: true, responseWindowMinutes: true },
      }),
      positionStatsQuery(),
    ])
    let positionStats = initialStats
    // Called people who ran out of time to show up are skipped first, so
    // every viewer (and the ETag) sees the line as it now stands.
    if (head?.responseWindowMinutes && await expireMissedCalls(lineId, head.responseWindowMinutes) > 0) {
      positionStats = await positionStatsQuery()
    }
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
          include: { user: { select: { id: true, name: true, image: true, isWalkIn: true } } },
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

    // Someone looking at a line that has just opened is the quickest moment
    // to email the people who asked to hear (the cron sweep is a backstop).
    if (emailEnabled() && line.opensAt && line.opensAt <= new Date() && Date.now() - line.opensAt.getTime() < REMINDER_WINDOW_MS) {
      runAfterResponse(() => sendDueLineReminders(lineId))
    }

    // The owner sees full names. People in the line see each other as
    // "First L.". Anyone else sees the queue's shape but not who is in it.
    const positions = viewer === "owner"
      ? line.positions
      : line.positions.map((p) => {
          if (p.userId === viewerId) return p
          // A party's note and the host's quote are between them and the host
          p = { ...p, note: null, quotedMinutes: null, quotedAt: null, response: null, respondedAt: null }
          // "First L." only: a profile photo identifies someone more than a full name
          if (viewer === "member") return { ...p, user: { ...p.user, name: shortName(p.user.name), image: null } }
          return {
            ...p,
            userId: `anon-${p.id}`,
            lockedBy: null,
            user: { id: `anon-${p.id}`, name: null, image: null, isWalkIn: false },
          }
        })

    // The called person's real account id would undo the anonymous positions
    // above (and follow them from line to line), so the public gets the
    // same stand-in id as their position.
    const servingPosition = line.positions.find((p) => p.userId === line.nowServingUserId)
    const nowServingUserId = viewer !== "public" || !line.nowServingUserId
      ? line.nowServingUserId
      : servingPosition ? `anon-${servingPosition.id}` : null

    // Why the viewer's last visit ended. A seated party whose row the host
    // then cleared looked, to a phone that slept through it, exactly like a
    // called no-show: "you didn't show up" right after being seated.
    const lastVisit = viewer === "public" && viewerId
      ? await prisma.queueVisit.findFirst({
          where: { lineId, userId: viewerId },
          orderBy: { exitedAt: "desc" },
          select: { outcome: true },
        })
      : null

    return NextResponse.json({
      ...line,
      nowServingUserId,
      positions,
      myLastOutcome: lastVisit?.outcome ?? null,
      ...capacity,
      platformFeePercent: getPlatformFeePercent(),
      emailEnabled: emailEnabled(),
    }, {
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
      select: { fulfilled: true, user: { select: { id: true, name: true, email: true, emailNotifications: true } } },
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
    await prisma.transaction.updateMany({
      where: { lineId, settledAt: null, status: "REFUNDED" },
      data: { settledAt: new Date() },
    })

    // Deleting now would take the settlement page -- the only place to retry
    // -- with it, and leave the buyer's money in limbo. Pause instead so
    // nothing new happens, and let the owner sort the refund out first.
    if (refundFailedCount > 0) {
      await setLineActive(lineId, false)
      return NextResponse.json(
        {
          error: `${refundFailedCount} buyer refund${refundFailedCount === 1 ? "" : "s"} couldn't be processed, so the line wasn't deleted. It's been paused. Remove ${refundFailedCount === 1 ? "that buyer" : "those buyers"} from the line with a refund (or collect the payment on the settlement page), then delete it.`,
          refundedCount,
          refundFailedCount,
        },
        { status: 409 }
      )
    }

    await prisma.$transaction(async (tx) => {
      // Offers aren't tied to the line by a foreign key, so clear them here.
      await tx.swapOffer.deleteMany({ where: { lineId } })
      await tx.line.delete({ where: { id: lineId } })
      // Walk-in names were typed in by the host for this line only; once
      // their spot and visit history are gone, nothing should keep them
      await tx.user.deleteMany({ where: { isWalkIn: true, positions: { none: {} }, queueVisits: { none: {} } } })
    })

    const buyers = new Set(transactionsToRefund.map((t) => t.buyerId))
    const browseUrl = `${getBaseUrl()}/browse`
    for (const { user, fulfilled } of members) {
      if (!user.email || !user.emailNotifications) continue
      // A party already seated (or served) lost nothing -- "your place is
      // gone" would only alarm them -- unless a payment of theirs was refunded
      if (fulfilled && !buyers.has(user.id)) continue
      const { subject, html } = lineDeletedEmail(user.name || "there", result.line.name, buyers.has(user.id), browseUrl, result.line.kind === "RESTAURANT")
      runAfterResponse(() => sendEmail(user.email!, subject, html))
    }

    return NextResponse.json({ success: true, refundedCount, refundFailedCount })
  } catch (error) {
    console.error("Delete line error:", error)
    // Only known messages go back as-is: a raw database or Stripe error
    // would land in the owner's toast
    const raw = error instanceof Error ? error.message : ""
    if (raw === "Line not found") return NextResponse.json({ error: raw }, { status: 404 })
    if (raw === "Not authorized") return NextResponse.json({ error: raw }, { status: 403 })
    return NextResponse.json({ error: "Couldn't delete this line. Try again in a moment." }, { status: 500 })
  }
}
