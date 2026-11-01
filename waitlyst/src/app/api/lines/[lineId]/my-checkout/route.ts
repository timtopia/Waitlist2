import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { abandonPendingTransaction, getStripe } from "@/lib/stripe"

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
  await abandonPendingTransaction(txn.id, { byBuyer: true })
  return NextResponse.json({ success: true })
}
