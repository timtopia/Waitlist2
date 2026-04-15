import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const { positionId } = await req.json()

  if (!positionId) {
    return NextResponse.json({ error: "Position ID required" }, { status: 400 })
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

      return { buyerTransactions, payoutsReleased }
    })

    // Process Stripe Connect transfers outside the transaction
    const stripe = getStripe()
    if (stripe && result.buyerTransactions.length > 0) {
      for (const txn of result.buyerTransactions) {
        try {
          // Look up seller's connected account
          const seller = await prisma.user.findUnique({
            where: { id: txn.sellerId },
            select: { stripeConnectId: true, stripeConnectOnboarded: true },
          })

          if (seller?.stripeConnectId && seller.stripeConnectOnboarded && txn.stripePaymentId) {
            // Retrieve the checkout session to get the payment intent
            const session = await stripe.checkout.sessions.retrieve(txn.stripePaymentId)
            if (session.payment_intent) {
              const paymentIntentId = typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent.id

              // Create a transfer to the seller's connected account
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
          }
        } catch (err) {
          console.error(`Failed to process payout for transaction ${txn.id}:`, err)
        }
      }
    }

    return NextResponse.json({
      fulfilled: true,
      payoutsReleased: result.payoutsReleased,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fulfill position"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
