import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBaseUrl, abandonPendingTransaction } from "@/lib/stripe"

/**
 * Handle Stripe Checkout cancellation redirect.
 * When the buyer cancels on the Stripe checkout page they're sent here: the
 * pending transaction is abandoned, both spots unlock, and an accepted offer
 * goes back to PENDING. This is a bare GET link, so it only acts for the
 * signed-in buyer and only on a still-PENDING checkout -- anyone else hitting
 * the URL (or a stale tab after the swap completed) changes nothing.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const url = new URL(req.url)
  const transactionId = url.searchParams.get("transaction_id")
  const baseUrl = getBaseUrl()

  if (transactionId) {
    try {
      const session = await auth()
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        select: { buyerId: true, lineId: true },
      })
      if (
        session?.user?.id &&
        transaction &&
        transaction.lineId === lineId &&
        transaction.buyerId === session.user.id
      ) {
        await abandonPendingTransaction(transactionId)
      }
    } catch (error) {
      console.error("Cancel payment error:", error)
      // Continue to redirect even if cleanup fails
    }
  }

  return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=cancelled`)
}
