import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma"
import { lineEvents } from "@/lib/events"
import Stripe from "stripe"

export async function POST(req: Request) {
  const body = await req.text()
  const headersList = await headers()
  const signature = headersList.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error("Webhook signature verification failed:", err)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session

    const {
      transactionId,
      lineId,
      buyerPositionId,
      sellerPositionId,
    } = session.metadata || {}

    if (!transactionId || !lineId || !buyerPositionId || !sellerPositionId) {
      console.error("Missing metadata in checkout session")
      return NextResponse.json({ error: "Missing metadata" }, { status: 400 })
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Verify positions still exist and are valid
        const buyerPosition = await tx.linePosition.findUnique({
          where: { id: buyerPositionId },
        })
        const sellerPosition = await tx.linePosition.findUnique({
          where: { id: sellerPositionId },
        })

        if (!buyerPosition || !sellerPosition) {
          throw new Error("Positions no longer exist")
        }

        // Verify they are still adjacent
        if (buyerPosition.position !== sellerPosition.position + 1) {
          throw new Error("Positions have changed since checkout started")
        }

        // Swap positions using temporary position to avoid unique constraint
        const tempPosition = -1

        await tx.linePosition.update({
          where: { id: buyerPosition.id },
          data: { position: tempPosition },
        })

        await tx.linePosition.update({
          where: { id: sellerPosition.id },
          data: {
            position: buyerPosition.position,
            askingPrice: null, // Remove from sale after swap
          },
        })

        await tx.linePosition.update({
          where: { id: buyerPosition.id },
          data: { position: sellerPosition.position },
        })

        // Update transaction status
        await tx.transaction.update({
          where: { id: transactionId },
          data: {
            status: "COMPLETED",
            stripePaymentId: session.payment_intent as string,
          },
        })
      })

      // Emit real-time update
      lineEvents.emit(lineId, { type: "swap", lineId })

      console.log(`Payment completed for transaction ${transactionId}`)
    } catch (error) {
      console.error("Error processing payment:", error)

      // Mark transaction as failed
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { status: "FAILED" },
      })

      return NextResponse.json({ error: "Failed to process swap" }, { status: 500 })
    }
  }

  return NextResponse.json({ received: true })
}
