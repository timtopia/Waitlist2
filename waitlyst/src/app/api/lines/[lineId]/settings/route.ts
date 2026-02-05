import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = await params
  const updates = await req.json()

  try {
    // Verify ownership
    const line = await prisma.line.findUnique({
      where: { id: lineId },
    })

    if (!line) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 })
    }

    if (line.createdById !== session.user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 })
    }

    // Only allow updating specific fields
    const allowedUpdates: Record<string, unknown> = {}
    if (typeof updates.isPublic === "boolean") {
      allowedUpdates.isPublic = updates.isPublic
    }
    if (typeof updates.isActive === "boolean") {
      allowedUpdates.isActive = updates.isActive
    }
    if (typeof updates.name === "string" && updates.name.trim()) {
      allowedUpdates.name = updates.name.trim()
    }
    if (typeof updates.description === "string") {
      allowedUpdates.description = updates.description.trim() || null
    }

    const updatedLine = await prisma.line.update({
      where: { id: lineId },
      data: allowedUpdates,
    })

    return NextResponse.json(updatedLine)
  } catch (error) {
    console.error("Settings update error:", error)
    return NextResponse.json({ error: "Failed to update settings" }, { status: 400 })
  }
}
