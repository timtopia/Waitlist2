import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getBaseUrl } from "@/lib/stripe"

/**
 * Handle Stripe Checkout cancellation redirect.
 * When a user cancels payment on the Stripe checkout page, they're sent here.
 * We unlock the positions and mark the transaction as FAILED.
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
      await prisma.$transaction(async (tx) => {
        // Find and unlock positions locked by this transaction
        await tx.linePosition.updateMany({
          where: { lockedBy: transactionId },
          data: {
            lockedUntil: null,
            lockedBy: null,
          },
        })

        // Mark transaction as failed
        await tx.transaction.update({
          where: { id: transactionId },
          data: { status: "FAILED" },
        })
      })
    } catch (error) {
      console.error("Cancel payment error:", error)
      // Continue to redirect even if cleanup fails
    }
  }

  return NextResponse.redirect(`${baseUrl}/lines/${lineId}?payment=cancelled`)
}
