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

  try {
    const line = await prisma.line.findUnique({
      where: { id: lineId },
    })

    if (!line) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 })
    }

    if (line.createdById !== session.user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 })
    }

    const updatedLine = await prisma.line.update({
      where: { id: lineId },
      data: { isActive: !line.isActive },
    })

    return NextResponse.json({ isActive: updatedLine.isActive })
  } catch (error) {
    console.error("Pause toggle error:", error)
    return NextResponse.json({ error: "Failed to update line status" }, { status: 500 })
  }
}
