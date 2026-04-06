import { NextResponse } from "next/server"

// Payment completion is handled directly in the checkout route (dev mode).
// This route is a placeholder for when Stripe integration is added.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000"
  return NextResponse.redirect(`${baseUrl}/lines/${lineId}`)
}
