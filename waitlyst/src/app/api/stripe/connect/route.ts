import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { getStripe, getBaseUrl } from "@/lib/stripe"

export async function POST() {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured. Payouts are available in production." },
      { status: 503 }
    )
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { id: true, email: true, stripeConnectId: true },
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    let connectAccountId = user.stripeConnectId

    // Create a new Connect Express account if user doesn't have one yet
    if (!connectAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: user.email || undefined,
        metadata: { userId: user.id },
      })

      connectAccountId = account.id

      await prisma.user.update({
        where: { id: user.id },
        data: { stripeConnectId: account.id },
      })
    }

    // Create an account link for onboarding (or resuming incomplete onboarding)
    const baseUrl = getBaseUrl()
    const accountLink = await stripe.accountLinks.create({
      account: connectAccountId,
      refresh_url: `${baseUrl}/api/stripe/connect/callback?account_id=${connectAccountId}`,
      return_url: `${baseUrl}/api/stripe/connect/callback?account_id=${connectAccountId}`,
      type: "account_onboarding",
    })

    return NextResponse.json({ url: accountLink.url })
  } catch (error) {
    console.error("Stripe Connect onboarding error:", error)
    const message = error instanceof Error ? error.message : "Failed to start payout setup"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
