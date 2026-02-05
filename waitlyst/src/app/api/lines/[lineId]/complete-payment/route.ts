import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma"
import { lineEvents } from "@/lib/events"

async function refundPayment(paymentIntentId: string, transactionId: string) {
  try {
    await stripe.refunds.create({
      payment_intent: paymentIntentId,
    })
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: "REFUNDED" },
    })
    return true
  } catch (error) {
    console.error("Refund failed:", error)
    return false
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const url = new URL(req.url)
  const sessionId = url.searchParams.get("session_id")
  const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000"

  if (!sessionId) {
    return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=error&message=Missing session`)
  }

  try {
    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    if (session.payment_status !== "paid") {
      return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=error&message=Payment not completed`)
    }

    const {
      transactionId,
      buyerPositionId,
      sellerPositionId,
    } = session.metadata || {}

    if (!transactionId || !buyerPositionId || !sellerPositionId) {
      return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=error&message=Invalid session data`)
    }

    // Check transaction status
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    })

    if (transaction?.status === "COMPLETED") {
      // Already processed, just redirect
      return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=success`)
    }

    if (transaction?.status === "REFUNDED") {
      // Already refunded
      return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=refunded&message=Transaction was cancelled and refunded`)
    }

    // If transaction was marked as FAILED (owner removed someone), issue refund
    if (transaction?.status === "FAILED") {
      const paymentIntentId = session.payment_intent as string
      await refundPayment(paymentIntentId, transactionId)
      return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=refunded&message=Position was removed by owner - payment refunded`)
    }

    // Verify positions still exist before attempting swap
    const buyerPosition = await prisma.linePosition.findUnique({
      where: { id: buyerPositionId },
    })
    const sellerPosition = await prisma.linePosition.findUnique({
      where: { id: sellerPositionId },
    })

    if (!buyerPosition || !sellerPosition) {
      // Positions were removed - refund the payment
      const paymentIntentId = session.payment_intent as string
      await refundPayment(paymentIntentId, transactionId)
      return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=refunded&message=Position no longer exists - payment refunded`)
    }

    // Complete the swap
    await prisma.$transaction(async (tx) => {
      // Swap positions using temporary position
      const tempPosition = -1

      await tx.linePosition.update({
        where: { id: buyerPosition.id },
        data: { position: tempPosition },
      })

      await tx.linePosition.update({
        where: { id: sellerPosition.id },
        data: {
          position: buyerPosition.position,
          askingPrice: null,
          lockedUntil: null,
          lockedBy: null,
        },
      })

      await tx.linePosition.update({
        where: { id: buyerPosition.id },
        data: {
          position: sellerPosition.position,
          lockedUntil: null,
          lockedBy: null,
        },
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

    // Emit real-time update for other viewers
    lineEvents.emit(lineId, { type: "swap", lineId })

    return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=success`)
  } catch (error) {
    console.error("Complete payment error:", error)
    return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=error&message=Failed to complete swap`)
  }
}
