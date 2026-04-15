import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
    const updatedLine = await prisma.line.update({
      where: { id: lineId },
      data: { isActive: !result.line.isActive },
    })

    return NextResponse.json({ isActive: updatedLine.isActive })
  } catch (error) {
    console.error("Pause toggle error:", error)
    return NextResponse.json(
      { error: "Something went wrong while updating the line status. Please try again." },
      { status: 500 }
    )
  }
}
