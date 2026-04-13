import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = await params

  const original = await prisma.line.findUnique({
    where: { id: lineId },
  })

  if (!original) {
    return NextResponse.json({ error: "Line not found" }, { status: 404 })
  }

  if (original.createdById !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  const newLine = await prisma.line.create({
    data: {
      name: `${original.name} (Copy)`,
      description: original.description,
      createdById: session.user.id,
      isPublic: original.isPublic,
      isActive: true,
      maxCapacity: original.maxCapacity,
      ownerFeePercent: original.ownerFeePercent,
    },
  })

  return NextResponse.json(newLine)
}
