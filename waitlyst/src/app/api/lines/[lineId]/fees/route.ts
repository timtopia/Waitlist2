import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getPlatformFeePercent } from "@/lib/fees"

export const dynamic = "force-dynamic"

/**
 * Returns fee percentages for a line so the client can show breakdowns.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  try {
    const line = await prisma.line.findUnique({
      where: { id: lineId },
      select: { ownerFeePercent: true },
    })

    if (!line) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 })
    }

    return NextResponse.json({
      ownerFeePercent: line.ownerFeePercent,
      platformFeePercent: getPlatformFeePercent(),
    })
  } catch (error) {
    console.error("Fees error:", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}
