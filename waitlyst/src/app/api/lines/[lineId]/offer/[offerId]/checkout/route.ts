import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import {
  getStripe,
  abandonPendingTransaction,
  isCheckoutAuthorized,
  recordPaymentIntent,
  performPositionSwap,
} from "@/lib/stripe"

/**
 * Lets the BUYER (the person who sent a swap offer) fetch the Stripe
 * Checkout link for an offer the seller has accepted. The accept endpoint
 * creates the Checkout Session but must never hand its URL to whoever
 * called accept (the seller) — only the buyer owes money here.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string; offerId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { lineId, offerId } = await params

  try {
    const offer = await prisma.swapOffer.findUnique({ where: { id: offerId } })
    if (!offer || offer.lineId !== lineId) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 })
    }

    if (offer.fromUserId !== result.userId) {
      return NextResponse.json(
        { error: "Only the person who made the offer can pay for it" },
        { status: 403 }
      )
    }

    if (offer.status !== "ACCEPTED") {
      return NextResponse.json(
        { error: `This offer is ${offer.status.toLowerCase()}, not accepted` },
        { status: 400 }
      )
    }

    const stripe = getStripe()
    if (!stripe) {
      return NextResponse.json(
        { error: "This swap doesn't require payment right now. Try refreshing the page." },
        { status: 400 }
      )
    }

    const transaction = offer.transactionId
      ? await prisma.transaction.findFirst({ where: { id: offer.transactionId, status: "PENDING" } })
      : null

    if (!transaction?.stripePaymentId) {
      return NextResponse.json(
        { error: "No pending payment found for this offer. It may have already been completed or cancelled." },
        { status: 404 }
      )
    }

    const session = await stripe.checkout.sessions.retrieve(transaction.stripePaymentId)
    if (session.status === "complete") {
      // They already paid (another tab, or the return page never loaded) and
      // the webhook hasn't landed yet. Telling them the window closed would
      // have them think they lost the spot -- or pay again. Finish the swap
      // the same way the return URL does; it's a no-op if already done.
      if (await isCheckoutAuthorized(session)) {
        await recordPaymentIntent(transaction.id, session)
        await performPositionSwap(transaction.id)
      }
      const settled = await prisma.transaction.findUnique({
        where: { id: transaction.id },
        select: { status: true },
      })
      if (settled?.status === "COMPLETED") {
        return NextResponse.json({ paid: true, message: "Your payment already went through -- the spot is yours." })
      }
      return NextResponse.json(
        { error: settled?.status === "FAILED"
          ? "The line changed before your swap could go through, so the hold on your card was released. You weren't charged."
          : "Your payment is still being confirmed. Refresh in a moment." },
        { status: 409 }
      )
    }
    if (session.status === "expired") {
      // Same cleanup as the checkout.session.expired webhook, in case it
      // hasn't arrived yet: free both spots and reopen the offer.
      await abandonPendingTransaction(transaction.id, {
        offerId,
        expireSession: false,
        // The seller started this checkout by accepting; the buyer may have
        // been away, so no strike, and the offer is closed, not reopened
        offerOutcome: "expire",
      })
      return NextResponse.json(
        { error: "That payment window closed, so the offer was called off. You weren't charged -- send a new offer if you still want their spot." },
        { status: 410 }
      )
    }
    if (!session.url) {
      return NextResponse.json(
        { error: "The payment window closed, so the offer was called off. You weren't charged." },
        { status: 410 }
      )
    }

    return NextResponse.json({ checkoutUrl: session.url })
  } catch (error) {
    console.error("Get offer checkout link error:", error)
    return NextResponse.json(
      { error: "Something went wrong while loading the payment link. Please try again." },
      { status: 500 }
    )
  }
}
