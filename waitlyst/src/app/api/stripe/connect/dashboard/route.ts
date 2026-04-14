import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"

export async function POST() {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 503 }
    )
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { stripeConnectId: true, stripeConnectOnboarded: true },
    })

    if (!user?.stripeConnectId || !user.stripeConnectOnboarded) {
      return NextResponse.json(
        { error: "Payout account not connected" },
        { status: 400 }
      )
    }

    const loginLink = await stripe.accounts.createLoginLink(user.stripeConnectId)

    return NextResponse.json({ url: loginLink.url })
  } catch (error) {
    console.error("Stripe Connect dashboard link error:", error)
    const message = error instanceof Error ? error.message : "Failed to create dashboard link"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
