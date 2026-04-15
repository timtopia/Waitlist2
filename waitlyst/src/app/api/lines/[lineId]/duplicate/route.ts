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
    const newLine = await prisma.line.create({
      data: {
        name: `${result.line.name} (Copy)`,
        description: result.line.description,
        createdById: result.userId,
        isPublic: result.line.isPublic,
        isActive: true,
        maxCapacity: result.line.maxCapacity,
        ownerFeePercent: result.line.ownerFeePercent,
      },
    })

    return NextResponse.json(newLine)
  } catch (error) {
    console.error("Duplicate line error:", error)
    return NextResponse.json(
      { error: "Something went wrong while duplicating the line. Please try again." },
      { status: 500 }
    )
  }
}
