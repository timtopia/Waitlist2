import { NextResponse } from "next/server"
import { runAfterResponse } from "@/lib/after-response"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import {
  getStripe,
  getBaseUrl,
  performPositionSwap,
  lockPositionsForTransaction,
  abandonPendingTransaction,
} from "@/lib/stripe"
import { paymentsUnavailable } from "@/lib/payments-mode"
import { calculateFees } from "@/lib/fees"
import { sendEmail } from "@/lib/email"
import { swapAcceptedEmail } from "@/lib/email-templates"
import { rateLimit } from "@/lib/rate-limit"
import { shortName } from "@/lib/privacy"
import { isOfferExpired } from "@/lib/offers"
import { tradeBlocker } from "@/lib/trading"

const LOCK_DURATION_MS = 30 * 60 * 1000 // 30 minutes
const offerRespondLimiter = rateLimit({ interval: 60000, limit: 10 })

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ lineId: string; offerId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { success } = offerRespondLimiter.check(result.userId)
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: { "Retry-After": "60" } })
  }

  const { lineId, offerId } = await params
  const { action } = await req.json()

  if (action !== "accept" && action !== "decline") {
    return NextResponse.json(
      { error: "Action must be 'accept' or 'decline'" },
      { status: 400 }
    )
  }

  try {
    // Find the offer
    const offer = await prisma.swapOffer.findUnique({
      where: { id: offerId },
    })

    if (!offer) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 })
    }

    if (offer.lineId !== lineId) {
      return NextResponse.json({ error: "Offer does not belong to this line" }, { status: 400 })
    }

    // Only the person receiving the offer can respond
    if (offer.toUserId !== result.userId) {
      return NextResponse.json(
        { error: "Only the recipient can respond to this offer" },
        { status: 403 }
      )
    }

    if (offer.status !== "PENDING") {
      return NextResponse.json(
        { error: `Offer has already been ${offer.status.toLowerCase()}` },
        { status: 400 }
      )
    }

    // Handle decline
    if (action === "decline") {
      const updated = await prisma.swapOffer.update({
        where: { id: offerId },
        data: { status: "DECLINED" },
      })
      return NextResponse.json(updated)
    }

    if (isOfferExpired(offer)) {
      await prisma.swapOffer.updateMany({
        where: { id: offerId, status: "PENDING" },
        data: { status: "EXPIRED" },
      })
      return NextResponse.json(
        { error: "This offer has expired. They can send you a new one." },
        { status: 410 }
      )
    }

    if (paymentsUnavailable()) {
      return NextResponse.json(
        { error: "Payments aren't available right now, so spots can't be bought or swapped. Please try again later." },
        { status: 503 }
      )
    }

    // Handle accept — initiate swap checkout
    const line = await prisma.line.findUnique({ where: { id: lineId } })
    if (!line || !line.isActive) {
      return NextResponse.json(
        { error: "This line is currently paused" },
        { status: 400 }
      )
    }

    if (!line.allowResale) {
      return NextResponse.json(
        { error: "Swapping is disabled for this line" },
        { status: 400 }
      )
    }

    // Get both positions
    const buyerPosition = await prisma.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: offer.fromUserId } },
    })
    const sellerPosition = await prisma.linePosition.findUnique({
      where: { lineId_userId: { lineId, userId: offer.toUserId } },
      include: { user: true, line: true },
    })

    if (!buyerPosition || !sellerPosition) {
      return NextResponse.json(
        { error: "One or both users are no longer in this line" },
        { status: 400 }
      )
    }

    // Re-check adjacency at accept time, not just when the offer was made.
    // Positions can shift between offer creation and acceptance (e.g. another
    // swap completed first), so an old offer can go stale. Accepting a stale
    // offer would let the offerer skip over whoever is now in between —
    // mark it DECLINED instead of letting the swap go through.
    if (sellerPosition.position !== buyerPosition.position - 1) {
      await prisma.swapOffer.update({
        where: { id: offerId },
        data: { status: "EXPIRED" },
      })
      return NextResponse.json(
        { error: "This offer is no longer valid -- queue positions have changed since it was sent." },
        { status: 409 }
      )
    }

    const blocked =
      tradeBlocker(sellerPosition, line.nowServingUserId, "yours") ??
      tradeBlocker(buyerPosition, line.nowServingUserId, "theirs")
    if (blocked) {
      return NextResponse.json({ error: blocked }, { status: 400 })
    }

    // Check if either position is locked
    const now = new Date()
    if (buyerPosition.lockedUntil && now < buyerPosition.lockedUntil) {
      return NextResponse.json(
        { error: "The buyer's position is currently involved in another transaction" },
        { status: 409 }
      )
    }
    if (sellerPosition.lockedUntil && now < sellerPosition.lockedUntil) {
      return NextResponse.json(
        { error: "Your position is currently involved in another transaction" },
        { status: 409 }
      )
    }

    const askingPrice = offer.amount
    const fees = calculateFees(askingPrice, line.ownerFeePercent)

    // Claim the offer atomically so a double-click (or two tabs) can't start
    // two checkouts for the same offer.
    const claimed = await prisma.swapOffer.updateMany({
      where: { id: offerId, status: "PENDING" },
      data: { status: "ACCEPTED" },
    })
    if (claimed.count === 0) {
      return NextResponse.json(
        { error: "This offer was already responded to" },
        { status: 409 }
      )
    }
    const revertOffer = () =>
      prisma.swapOffer.updateMany({
        where: { id: offerId, status: "ACCEPTED" },
        data: { status: "PENDING", transactionId: null },
      })

    // --- STRIPE MODE ---
    const stripe = getStripe()
    if (stripe) {
      const lockUntil = new Date(Date.now() + LOCK_DURATION_MS)

      let transaction
      try {
        transaction = await prisma.$transaction(async (tx) => {
          const txn = await tx.transaction.create({
            data: {
              buyerId: offer.fromUserId,
              sellerId: offer.toUserId,
              lineId,
              amount: askingPrice,
              ownerFee: fees.ownerFee,
              platformFee: fees.platformFee,
              status: "PENDING",
            },
          })

          const locked = await lockPositionsForTransaction(
            tx,
            [buyerPosition.id, sellerPosition.id],
            txn.id,
            lockUntil
          )
          if (!locked) throw new Error("POSITIONS_LOCKED")

          await tx.swapOffer.update({ where: { id: offerId }, data: { transactionId: txn.id } })
          return txn
        })
      } catch (error) {
        await revertOffer()
        if (error instanceof Error && error.message === "POSITIONS_LOCKED") {
          return NextResponse.json(
            { error: "One of these spots just got pulled into another swap. Try again in a moment." },
            { status: 409 }
          )
        }
        throw error
      }

      // Look up seller's and owner's Stripe Connect accounts
      const seller = await prisma.user.findUnique({
        where: { id: offer.toUserId },
        select: { stripeConnectId: true, stripeConnectOnboarded: true },
      })

      const sellerConnected = seller?.stripeConnectId && seller?.stripeConnectOnboarded

      const paymentIntentData: Record<string, unknown> = {
        capture_method: "manual", // Authorize only — capture happens on fulfillment
      }
      if (sellerConnected) {
        paymentIntentData.application_fee_amount = Math.round((fees.platformFee + fees.ownerFee) * 100)
        paymentIntentData.transfer_data = {
          destination: seller.stripeConnectId,
        }
      }

      try {
        const baseUrl = getBaseUrl()
        const sessionParams: Record<string, unknown> = {
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: `Position #${sellerPosition.position} in ${sellerPosition.line.name}`,
                  description: `Swap offer accepted — buy position #${sellerPosition.position} from ${shortName(sellerPosition.user.name) || "someone"}`,
                },
                unit_amount: Math.round(fees.totalPrice * 100),
              },
              quantity: 1,
            },
          ],
          metadata: {
            transactionId: transaction.id,
            lineId,
            buyerId: offer.fromUserId,
            sellerId: offer.toUserId,
            offerId,
          },
          success_url: `${baseUrl}/api/lines/${lineId}/complete-payment?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/api/lines/${lineId}/cancel-payment?transaction_id=${transaction.id}`,
          expires_at: Math.floor(lockUntil.getTime() / 1000),
          payment_intent_data: paymentIntentData,
        }

        const checkoutSession = await stripe.checkout.sessions.create(
          sessionParams as Parameters<typeof stripe.checkout.sessions.create>[0]
        )

        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { stripePaymentId: checkoutSession.id },
        })

        notifyOffererAccepted(offer.fromUserId, line.name, lineId)

        // IMPORTANT: this response goes to the SELLER (only the offer's
        // recipient can call accept), but it's the BUYER who owes money.
        // Never send checkoutUrl here — the buyer fetches their own payment
        // link from GET /offer/[offerId]/checkout once they see ACCEPTED.
        return NextResponse.json({
          offer: { ...offer, status: "ACCEPTED" },
          pendingBuyerPayment: true,
        })
      } catch (stripeError) {
        console.error("Stripe checkout session creation failed:", stripeError)
        await prisma.$transaction(async (tx) => {
          await tx.linePosition.updateMany({
            where: { lockedBy: transaction.id },
            data: { lockedUntil: null, lockedBy: null },
          })
          await tx.transaction.update({
            where: { id: transaction.id },
            data: { status: "FAILED" },
          })
        })
        await revertOffer()
        // Stripe's own message can be technical or leak account details
        return NextResponse.json(
          { error: "We couldn't start the payment. Please try again in a moment." },
          { status: 502 }
        )
      }
    }

    // --- DEV MODE ---
    const transaction = await prisma.transaction.create({
      data: {
        buyerId: offer.fromUserId,
        sellerId: offer.toUserId,
        lineId,
        amount: askingPrice,
        ownerFee: fees.ownerFee,
        platformFee: fees.platformFee,
        status: "PENDING",
      },
    })
    await prisma.swapOffer.update({ where: { id: offerId }, data: { transactionId: transaction.id } })

    const swapped = await performPositionSwap(transaction.id)

    if (!swapped) {
      await revertOffer()
      return NextResponse.json(
        { error: "The queue changed before the swap could finish. Please refresh and try again." },
        { status: 409 }
      )
    }

    notifyOffererAccepted(offer.fromUserId, line.name, lineId)

    return NextResponse.json({
      offer: { ...offer, status: "ACCEPTED" },
      devMode: true,
      message: "Position swapped successfully (dev mode)",
    })
  } catch (error) {
    console.error("Respond to offer error:", error)
    return NextResponse.json(
      { error: "Something went wrong while processing the offer. Please try again." },
      { status: 500 }
    )
  }
}

/**
 * The offerer withdraws their offer. Works while it's still PENDING, and also
 * after it was accepted but before they paid -- that abandons the checkout
 * and frees both spots instead of leaving them locked for 30 minutes.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ lineId: string; offerId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { success } = offerRespondLimiter.check(result.userId)
  if (!success) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: { "Retry-After": "60" } })
  }

  const { lineId, offerId } = await params

  try {
    const offer = await prisma.swapOffer.findUnique({ where: { id: offerId } })
    if (!offer || offer.lineId !== lineId) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 })
    }
    if (offer.fromUserId !== result.userId) {
      return NextResponse.json(
        { error: "Only the person who made the offer can withdraw it" },
        { status: 403 }
      )
    }

    if (offer.status === "ACCEPTED") {
      const pending = offer.transactionId
        ? await prisma.transaction.findFirst({ where: { id: offer.transactionId, status: "PENDING" } })
        : null
      if (!pending) {
        return NextResponse.json(
          { error: "This swap already went through and can't be withdrawn" },
          { status: 400 }
        )
      }
      await abandonPendingTransaction(pending.id, { offerId: null })
    } else if (offer.status !== "PENDING") {
      return NextResponse.json(
        { error: `This offer was already ${offer.status.toLowerCase()}` },
        { status: 400 }
      )
    }

    // Kept (not deleted) so the person in front sees it was taken back.
    await prisma.swapOffer.update({
      where: { id: offerId },
      data: { status: "WITHDRAWN", transactionId: null },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Withdraw offer error:", error)
    return NextResponse.json(
      { error: "Something went wrong while withdrawing the offer. Please try again." },
      { status: 500 }
    )
  }
}

function notifyOffererAccepted(offererId: string, lineName: string, lineId: string) {
  runAfterResponse(() => prisma.user
    .findUnique({
      where: { id: offererId },
      select: { name: true, email: true, emailNotifications: true },
    })
    .then((offerer) => {
      if (!offerer?.email || !offerer.emailNotifications) return
      const { subject, html } = swapAcceptedEmail(
        offerer.name || "there",
        lineName,
        `${getBaseUrl()}/lines/${lineId}`
      )
      return sendEmail(offerer.email, subject, html)
    }))
}
