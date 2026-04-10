import { NextResponse } from "next/server"

// Temporary debug endpoint — remove after confirming Stripe works
export async function GET() {
  const key = process.env.STRIPE_SECRET_KEY
  return NextResponse.json({
    hasStripeKey: !!key,
    keyPrefix: key ? key.substring(0, 12) + "..." : null,
    keyLength: key?.length ?? 0,
    nodeEnv: process.env.NODE_ENV,
    hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
    hasPublishableKey: !!process.env.STRIPE_PUBLISHABLE_KEY,
  })
}
