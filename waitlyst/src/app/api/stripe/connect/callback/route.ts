import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { getStripe, getBaseUrl, payOutstandingPayouts } from "@/lib/stripe"
import { sanitizeReturnPath } from "@/lib/validate"

export async function GET(req: Request) {
  const url = new URL(req.url)
  // Send the owner back to wherever they started the Connect flow from
  // (e.g. a line's settlement page), not always /profile.
  const returnTo = sanitizeReturnPath(url.searchParams.get("return_to"), "/profile")
  const redirectWith = (status: "success" | "incomplete" | "error") => {
    const sep = returnTo.includes("?") ? "&" : "?"
    return `${returnTo}${sep}connect=${status}`
  }

  const result = await requireAuth()
  if (result instanceof NextResponse) {
    // Not authenticated — redirect to home
    const baseUrl = getBaseUrl()
    return NextResponse.redirect(`${baseUrl}/`)
  }

  const stripe = getStripe()
  const baseUrl = getBaseUrl()

  if (!stripe) {
    return NextResponse.redirect(`${baseUrl}${redirectWith("error")}`)
  }

  try {
    const accountId = url.searchParams.get("account_id")

    if (!accountId) {
      return NextResponse.redirect(`${baseUrl}${redirectWith("error")}`)
    }

    // Verify the account belongs to this user
    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { stripeConnectId: true },
    })

    if (!user || user.stripeConnectId !== accountId) {
      return NextResponse.redirect(`${baseUrl}${redirectWith("error")}`)
    }

    // Check the account status
    const account = await stripe.accounts.retrieve(accountId)

    if (account.charges_enabled && account.payouts_enabled) {
      await prisma.user.update({
        where: { id: result.userId },
        data: { stripeConnectOnboarded: true },
      })
      // Sales and owner fees collected before they could be paid are
      // sitting in the platform balance. Each share is marked once paid, so
      // revisiting this page never sends one twice.
      await payOutstandingPayouts(result.userId).catch((err) =>
        console.error("Catch-up payouts failed:", err)
      )
      return NextResponse.redirect(`${baseUrl}${redirectWith("success")}`)
    }

    // Onboarding is incomplete
    return NextResponse.redirect(`${baseUrl}${redirectWith("incomplete")}`)
  } catch (error) {
    console.error("Stripe Connect callback error:", error)
    return NextResponse.redirect(`${baseUrl}${redirectWith("error")}`)
  }
}
