import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { getStripe, abandonPendingTransaction } from "@/lib/stripe"

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
    if (session.status === "expired") {
      // Same cleanup as the checkout.session.expired webhook, in case it
      // hasn't arrived yet: free both spots and reopen the offer.
      await abandonPendingTransaction(transaction.id, {
        offerId,
        expireSession: false,
        // Nobody paid before the window closed
        byBuyer: true,
      })
      return NextResponse.json(
        { error: "That payment window closed. Your offer went back to them to accept again." },
        { status: 410 }
      )
    }
    if (!session.url) {
      return NextResponse.json(
        { error: "This payment link has expired. Ask them to accept the offer again." },
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
