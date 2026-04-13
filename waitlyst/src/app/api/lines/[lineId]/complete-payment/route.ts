import { NextResponse } from "next/server"
import { getStripe, getBaseUrl, performPositionSwap } from "@/lib/stripe"
import { prisma } from "@/lib/prisma"

/**
 * Handle Stripe Checkout success redirect.
 * Stripe sends users here after successful payment with ?session_id=cs_xxx
 *
 * This verifies the payment, performs the position swap, and redirects to the line page.
 * The swap is idempotent — if the webhook already completed it, this is a no-op.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const url = new URL(req.url)
  const sessionId = url.searchParams.get("session_id")
  const baseUrl = getBaseUrl()

  if (!sessionId) {
    return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=error&reason=missing_session`)
  }

  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=error&reason=stripe_not_configured`)
  }

  try {
    // Retrieve the checkout session from Stripe to verify payment
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId)

    if (checkoutSession.payment_status !== "paid") {
      console.error(`Payment not completed for session ${sessionId}: status=${checkoutSession.payment_status}`)
      return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=error&reason=not_paid`)
    }

    const transactionId = checkoutSession.metadata?.transactionId
    if (!transactionId) {
      console.error(`No transactionId in session ${sessionId} metadata`)
      return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=error&reason=no_transaction`)
    }

    // Verify the transaction exists and belongs to this line
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    })

    if (!transaction || transaction.lineId !== lineId) {
      console.error(`Transaction ${transactionId} not found or wrong line`)
      return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=error&reason=invalid_transaction`)
    }

    // Perform the swap (idempotent — won't swap again if already completed by webhook)
    const swapped = await performPositionSwap(transactionId)

    // Whether we swapped or it was already done, the payment was successful
    return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=success`)
  } catch (error) {
    console.error("Complete payment error:", error)
    return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=error`)
  }
}
