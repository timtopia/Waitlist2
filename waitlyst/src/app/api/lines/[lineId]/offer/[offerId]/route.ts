import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { getStripe, getBaseUrl, performPositionSwap } from "@/lib/stripe"
import { calculateFees } from "@/lib/fees"
import { sendEmail } from "@/lib/email"
import { swapAcceptedEmail } from "@/lib/email-templates"
import { rateLimit } from "@/lib/rate-limit"

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

    // Mark offer as accepted
    await prisma.swapOffer.update({
      where: { id: offerId },
      data: { status: "ACCEPTED" },
    })

    // Send email notification to the offerer (fire-and-forget)
    const offerer = await prisma.user.findUnique({
      where: { id: offer.fromUserId },
      select: { name: true, email: true, emailNotifications: true },
    })
    if (offerer?.email && offerer.emailNotifications) {
      const baseUrl = getBaseUrl()
      const lineUrl = `${baseUrl}/lines/${lineId}`
      const { subject, html } = swapAcceptedEmail(
        offerer.name || "there",
        line.name,
        lineUrl
      )
      sendEmail(offerer.email, subject, html).catch(() => {})
    }

    // --- STRIPE MODE ---
    const stripe = getStripe()
    if (stripe) {
      const lockUntil = new Date(Date.now() + LOCK_DURATION_MS)

      const transaction = await prisma.$transaction(async (tx) => {
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

        // Lock both positions
        await tx.linePosition.update({
          where: { id: buyerPosition.id },
          data: { lockedUntil: lockUntil, lockedBy: txn.id },
        })
        await tx.linePosition.update({
          where: { id: sellerPosition.id },
          data: { lockedUntil: lockUntil, lockedBy: txn.id },
        })

        return txn
      })

      // Look up seller's and owner's Stripe Connect accounts
      const seller = await prisma.user.findUnique({
        where: { id: offer.toUserId },
        select: { stripeConnectId: true, stripeConnectOnboarded: true },
      })
      const lineOwner = await prisma.user.findUnique({
        where: { id: line.createdById },
        select: { stripeConnectId: true, stripeConnectOnboarded: true },
      })

      const sellerConnected = seller?.stripeConnectId && seller?.stripeConnectOnboarded
      const ownerConnected = lineOwner?.stripeConnectId && lineOwner?.stripeConnectOnboarded
      const ownerIsNotSeller = line.createdById !== offer.toUserId

      const paymentIntentData: Record<string, unknown> = {
        capture_method: "manual", // Authorize only — capture happens on fulfillment
      }
      if (sellerConnected) {
        paymentIntentData.application_fee_amount = Math.round((fees.platformFee + fees.ownerFee) * 100)
        paymentIntentData.transfer_data = {
          destination: seller.stripeConnectId,
        }
        if (ownerConnected && ownerIsNotSeller && fees.ownerFee > 0) {
          paymentIntentData.metadata = {
            ownerConnectId: lineOwner.stripeConnectId,
            ownerFeeAmountCents: String(Math.round(fees.ownerFee * 100)),
          }
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
                  description: `Swap offer accepted — buy position #${sellerPosition.position} from ${sellerPosition.user.name || "Anonymous"}`,
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
            ...(ownerConnected && ownerIsNotSeller && fees.ownerFee > 0 ? {
              ownerConnectId: lineOwner.stripeConnectId,
              ownerFeeAmountCents: String(Math.round(fees.ownerFee * 100)),
            } : {}),
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

        return NextResponse.json({
          offer: { ...offer, status: "ACCEPTED" },
          checkoutUrl: checkoutSession.url,
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
        // Revert offer status
        await prisma.swapOffer.update({
          where: { id: offerId },
          data: { status: "PENDING" },
        })
        const msg = stripeError instanceof Error ? stripeError.message : "Payment service error"
        return NextResponse.json({ error: msg }, { status: 502 })
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

    const swapped = await performPositionSwap(transaction.id)

    if (!swapped) {
      // Revert offer status on failure
      await prisma.swapOffer.update({
        where: { id: offerId },
        data: { status: "PENDING" },
      })
      return NextResponse.json(
        { error: "Failed to complete position swap" },
        { status: 500 }
      )
    }

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
