import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import {
  abandonPendingTransaction,
  getStripe,
  isCheckoutAuthorized,
  performPositionSwap,
  recordPaymentIntent,
} from "@/lib/stripe"

/**
 * The signed-in buyer's own unpaid direct purchase on this line: the one
 * their spot is locked for. Accepted offers have their own Complete Payment
 * and Back Out buttons, so they're left out.
 */
async function ownPendingPurchase(lineId: string, userId: string) {
  const position = await prisma.linePosition.findUnique({
    where: { lineId_userId: { lineId, userId } },
    select: { lockedBy: true, lockedUntil: true },
  })
  if (!position?.lockedBy || !position.lockedUntil || position.lockedUntil <= new Date()) return null
  const txn = await prisma.transaction.findFirst({
    where: { id: position.lockedBy, lineId, buyerId: userId, status: "PENDING" },
  })
  if (!txn) return null
  const fromOffer = await prisma.swapOffer.count({ where: { transactionId: txn.id } })
  return fromOffer > 0 ? null : txn
}

/**
 * Closing the Stripe tab (or pressing Back) instead of its cancel link left
 * both spots locked for half an hour with nothing to do but wait. This lets
 * the buyer pick the payment back up.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const { lineId } = await params

  const txn = await ownPendingPurchase(lineId, result.userId)
  if (!txn) return NextResponse.json({ pending: false })

  let url: string | null = null
  const stripe = getStripe()
  if (stripe && txn.stripePaymentId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(txn.stripePaymentId)
      if (session.status === "open") url = session.url
      // They paid but closed the tab before the return page loaded, and the
      // webhook hasn't landed: "you haven't paid yet" plus a Cancel button
      // would have them undo a purchase they already made. Finish it the
      // way the return URL does (a no-op if already done).
      if (session.status === "complete" && (await isCheckoutAuthorized(session))) {
        await recordPaymentIntent(txn.id, session)
        await performPositionSwap(txn.id)
        // The spot may have changed hands while they were paying, in which
        // case the swap was called off and the hold released: "the spot is
        // yours" would be a lie
        const settled = await prisma.transaction.findUnique({
          where: { id: txn.id },
          select: { status: true },
        })
        if (settled?.status === "COMPLETED") return NextResponse.json({ pending: false, paid: true })
        return NextResponse.json({ pending: false, released: true })
      }
    } catch {
      // Gone or unreachable: they can still cancel
    }
  }
  return NextResponse.json({ pending: true, url })
}

/** ...or call it off now, unlocking both spots */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const { lineId } = await params

  const txn = await ownPendingPurchase(lineId, result.userId)
  if (!txn) {
    return NextResponse.json({ error: "You don't have a purchase waiting for payment here" }, { status: 404 })
  }
  const stripe = getStripe()
  if (stripe && txn.stripePaymentId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(txn.stripePaymentId)
      if (session.status === "complete") {
        return NextResponse.json(
          { error: "Your payment already went through. Refresh in a moment to see your new spot." },
          { status: 409 }
        )
      }
    } catch {
      // Unreachable: cancelling still expires the session below
    }
  }
  await abandonPendingTransaction(txn.id, { byBuyer: true })
  return NextResponse.json({ success: true })
}
