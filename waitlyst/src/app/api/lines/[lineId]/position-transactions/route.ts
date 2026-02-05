import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Get transaction info for a specific user in a line
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = await params
  const url = new URL(req.url)
  const userId = url.searchParams.get("userId")

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 })
  }

  // Verify caller is the line owner
  const line = await prisma.line.findUnique({
    where: { id: lineId },
  })

  if (!line) {
    return NextResponse.json({ error: "Line not found" }, { status: 404 })
  }

  if (line.createdById !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  // Get all completed transactions where this user was buyer or seller
  const [asBuyer, asSeller] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        lineId,
        buyerId: userId,
        status: "COMPLETED",
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.transaction.findMany({
      where: {
        lineId,
        sellerId: userId,
        status: "COMPLETED",
      },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const totalPaid = asBuyer.reduce((sum, t) => sum + t.amount, 0)
  const totalReceived = asSeller.reduce((sum, t) => sum + t.amount, 0)

  return NextResponse.json({
    asBuyer,
    asSeller,
    totalPaid,
    totalReceived,
    netAmount: totalReceived - totalPaid,
  })
}
