import { NextResponse } from "next/server"

// Stripe webhook handler — placeholder for when Stripe integration is added.
export async function POST(req: Request) {
  return NextResponse.json({ received: true, message: "Stripe not configured" })
}
