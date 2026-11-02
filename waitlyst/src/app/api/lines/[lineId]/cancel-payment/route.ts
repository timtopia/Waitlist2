import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBaseUrl, abandonPendingTransaction } from "@/lib/stripe"

/**
 * Handle Stripe Checkout cancellation redirect.
 * When the buyer cancels on the Stripe checkout page they're sent here: the
 * pending transaction is abandoned and both spots unlock. Backing out of
 * paying for an accepted offer withdraws the offer -- reopening it would let
 * the seller accept again and re-lock both spots for something the buyer
 * just walked away from. This is a bare GET link, so it only acts for the
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
  let offerWithdrawn = false

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
        const offer = await prisma.swapOffer.findFirst({
          where: { transactionId, status: "ACCEPTED" },
          select: { id: true },
        })
        const abandoned = await abandonPendingTransaction(transactionId, {
          byBuyer: true,
          ...(offer ? { offerId: null } : {}),
        })
        if (abandoned && offer) {
          const { count } = await prisma.swapOffer.updateMany({
            where: { id: offer.id, status: "ACCEPTED" },
            // createdAt restarts the cooldown before they can send another
            data: { status: "WITHDRAWN", createdAt: new Date() },
          })
          offerWithdrawn = count > 0
        }
      }
    } catch (error) {
      console.error("Cancel payment error:", error)
      // Continue to redirect even if cleanup fails
    }
  }

  return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=${offerWithdrawn ? "offer_withdrawn" : "cancelled"}`)
}
