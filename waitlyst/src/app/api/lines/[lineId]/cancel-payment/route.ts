import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const url = new URL(req.url)
  const transactionId = url.searchParams.get("transaction_id")
  const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000"

  if (transactionId) {
    try {
      // Unlock positions that were locked by this transaction
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
