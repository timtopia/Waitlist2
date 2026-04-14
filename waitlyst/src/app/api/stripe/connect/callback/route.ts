import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { getStripe, getBaseUrl } from "@/lib/stripe"

export async function GET(req: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) {
    // Not authenticated — redirect to home
    const baseUrl = getBaseUrl()
    return NextResponse.redirect(`${baseUrl}/`)
  }

  const stripe = getStripe()
  const baseUrl = getBaseUrl()

  if (!stripe) {
    return NextResponse.redirect(`${baseUrl}/profile?connect=error`)
  }

  try {
    const url = new URL(req.url)
    const accountId = url.searchParams.get("account_id")

    if (!accountId) {
      return NextResponse.redirect(`${baseUrl}/profile?connect=error`)
    }

    // Verify the account belongs to this user
    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { stripeConnectId: true },
    })

    if (!user || user.stripeConnectId !== accountId) {
      return NextResponse.redirect(`${baseUrl}/profile?connect=error`)
    }

    // Check the account status
    const account = await stripe.accounts.retrieve(accountId)

    if (account.charges_enabled && account.payouts_enabled) {
      await prisma.user.update({
        where: { id: result.userId },
        data: { stripeConnectOnboarded: true },
      })
      return NextResponse.redirect(`${baseUrl}/profile?connect=success`)
    }

    // Onboarding is incomplete
    return NextResponse.redirect(`${baseUrl}/profile?connect=incomplete`)
  } catch (error) {
    console.error("Stripe Connect callback error:", error)
    return NextResponse.redirect(`${baseUrl}/profile?connect=error`)
  }
}
