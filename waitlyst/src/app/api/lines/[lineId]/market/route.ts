import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// Public market data endpoint — no auth required
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  // Verify line exists
  const line = await prisma.line.findUnique({
    where: { id: lineId },
    select: { id: true },
  })

  if (!line) {
    return NextResponse.json({ error: "Line not found" }, { status: 404 })
  }

  // Get all COMPLETED transactions for this line
  const completedTransactions = await prisma.transaction.findMany({
    where: { lineId, status: "COMPLETED" },
    select: { amount: true },
  })

  // Calculate market stats from completed transactions
  const count = completedTransactions.length
  let avgPrice = 0
  let minPrice = 0
  let maxPrice = 0
  let volume = 0

  if (count > 0) {
    const amounts = completedTransactions.map((t) => t.amount)
    minPrice = Math.min(...amounts)
    maxPrice = Math.max(...amounts)
    volume = amounts.reduce((sum, a) => sum + a, 0)
    avgPrice = Math.round((volume / count) * 100) / 100
  }

  // Get current asking prices from positions that are for sale (not locked)
  const forSalePositions = await prisma.linePosition.findMany({
    where: {
      lineId,
      askingPrice: { not: null },
      OR: [
        { lockedUntil: null },
        { lockedUntil: { lt: new Date() } },
      ],
    },
    select: { askingPrice: true },
  })

  const currentListings = forSalePositions.length
  const askingPrices = forSalePositions
    .map((p) => p.askingPrice!)
    .sort((a, b) => a - b)
  const lowestAsk = askingPrices.length > 0 ? askingPrices[0] : null

  return NextResponse.json(
    {
      avgPrice,
      minPrice,
      maxPrice,
      volume,
      count,
      currentListings,
      lowestAsk,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  )
}
