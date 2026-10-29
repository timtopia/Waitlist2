import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { getStripe, getBaseUrl } from "@/lib/stripe"
import { sanitizeReturnPath } from "@/lib/validate"

export async function POST(req: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  // Where to send the owner back to once onboarding finishes -- e.g. the
  // settlement page they started from, not always /profile.
  const body = await req.json().catch(() => ({}))
  const returnTo = sanitizeReturnPath(body?.returnTo, "/profile")

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
    const callbackUrl = `${baseUrl}/api/stripe/connect/callback?account_id=${connectAccountId}&return_to=${encodeURIComponent(returnTo)}`
    const accountLink = await stripe.accountLinks.create({
      account: connectAccountId,
      refresh_url: callbackUrl,
      return_url: callbackUrl,
      type: "account_onboarding",
    })

    return NextResponse.json({ url: accountLink.url })
  } catch (error) {
    console.error("Stripe Connect onboarding error:", error)
    return NextResponse.json(
      { error: "Something went wrong while setting up payouts. Please try again." },
      { status: 500 }
    )
  }
}
