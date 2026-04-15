import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { getStripe, captureAuthorization } from "@/lib/stripe"
import { sendEmail } from "@/lib/email"
import { fulfilledEmail } from "@/lib/email-templates"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const { positionId } = await req.json()

  if (!positionId || typeof positionId !== "string") {
    return NextResponse.json({ error: "Position ID is required" }, { status: 400 })
  }

  const authResult = await requireLineOwner(lineId)
  if (authResult instanceof NextResponse) return authResult

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Get the position to fulfill
      const position = await tx.linePosition.findUnique({
        where: { id: positionId, lineId },
        include: { user: true },
      })
      if (!position) {
        throw new Error("Position not found")
      }

      if (position.fulfilled) {
        throw new Error("Position already fulfilled")
      }

      // Mark position as fulfilled
      await tx.linePosition.update({
        where: { id: positionId },
        data: {
          fulfilled: true,
          fulfilledAt: new Date(),
        },
      })

      // Find all COMPLETED transactions where this user was the BUYER
      // (they paid to swap forward). Release payment to the sellers.
      const buyerTransactions = await tx.transaction.findMany({
        where: {
          lineId,
          buyerId: position.userId,
          status: "COMPLETED",
          settledAt: null,
        },
      })

      // Mark these transactions as settled (payment released)
      const now = new Date()
      let payoutsReleased = 0

      if (buyerTransactions.length > 0) {
        await tx.transaction.updateMany({
          where: {
            id: { in: buyerTransactions.map((t) => t.id) },
          },
          data: { settledAt: now },
        })
        payoutsReleased = buyerTransactions.length
      }

      return { position, buyerTransactions, payoutsReleased }
    })

    // Capture authorized payments and process Stripe Connect transfers
    const stripe = getStripe()
    if (stripe && result.buyerTransactions.length > 0) {
      for (const txn of result.buyerTransactions) {
        try {
          // First, capture the authorized payment (auth-then-capture flow)
          if (txn.stripePaymentId) {
            const capturedAmount = await captureAuthorization(txn.stripePaymentId)
            if (capturedAmount !== null) {
              // Payment captured successfully
            } else {
              console.warn(`Could not capture payment for transaction ${txn.id} — may already be captured`)
            }
          }

          // Then, process Stripe Connect transfer to seller
          const seller = await prisma.user.findUnique({
            where: { id: txn.sellerId },
            select: { stripeConnectId: true, stripeConnectOnboarded: true },
          })

          if (txn.stripePaymentId) {
            // Retrieve the checkout session to get the payment intent and metadata
            const session = await stripe.checkout.sessions.retrieve(txn.stripePaymentId)
            if (session.payment_intent) {
              const paymentIntentId = typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent.id

              // Transfer seller payout via Connect
              if (seller?.stripeConnectId && seller.stripeConnectOnboarded) {
                await stripe.transfers.create({
                  amount: Math.round(txn.amount * 100), // Convert to cents
                  currency: "usd",
                  destination: seller.stripeConnectId,
                  source_transaction: paymentIntentId,
                  description: `Swap payout for fulfilled position in line`,
                }).catch((err) => {
                  // Log but don't fail — the transaction is already marked settled
                  console.error(`Stripe transfer failed for transaction ${txn.id}:`, err)
                })
              }

              // Transfer owner fee if applicable (moved here from webhook for auth-then-capture)
              const ownerConnectId = session.metadata?.ownerConnectId
              const ownerFeeAmountCents = session.metadata?.ownerFeeAmountCents
              if (ownerConnectId && ownerFeeAmountCents && parseInt(ownerFeeAmountCents) > 0) {
                try {
                  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
                  const chargeId = typeof paymentIntent.latest_charge === "string"
                    ? paymentIntent.latest_charge
                    : (paymentIntent.latest_charge as { id: string } | null)?.id

                  await stripe.transfers.create({
                    amount: parseInt(ownerFeeAmountCents),
                    currency: "usd",
                    destination: ownerConnectId,
                    ...(chargeId ? { source_transaction: chargeId } : {}),
                    metadata: {
                      transactionId: txn.id,
                      type: "owner_fee",
                    },
                  })
                  // Owner fee transferred successfully
                } catch (transferError) {
                  console.error(`Owner fee transfer failed for transaction ${txn.id}:`, transferError)
                }
              }
            }
          }
        } catch (err) {
          console.error(`Failed to process payout for transaction ${txn.id}:`, err)
        }
      }
    }

    // Send email notification to the fulfilled person (fire-and-forget)
    const fulfilledUser = result.position.user
    if (fulfilledUser?.email && fulfilledUser.emailNotifications) {
      const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000"
      const line = await prisma.line.findUnique({ where: { id: lineId }, select: { name: true } })
      if (line) {
        const lineUrl = `${baseUrl}/lines/${lineId}`
        const { subject, html } = fulfilledEmail(
          fulfilledUser.name || "there",
          line.name,
          lineUrl
        )
        sendEmail(fulfilledUser.email, subject, html).catch(() => {})
      }
    }

    return NextResponse.json({
      fulfilled: true,
      payoutsReleased: result.payoutsReleased,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "Position not found") {
      return NextResponse.json(
        { error: "Could not find this position. The person may have already left the line." },
        { status: 404 }
      )
    }
    if (message === "Position already fulfilled") {
      return NextResponse.json(
        { error: "This position has already been fulfilled" },
        { status: 400 }
      )
    }
    console.error("Fulfill error:", error)
    return NextResponse.json(
      { error: "Something went wrong while fulfilling this position. Please try again." },
      { status: 500 }
    )
  }
}
