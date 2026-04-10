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
    // Schedule fields
    if (updates.opensAt !== undefined) {
      allowedUpdates.opensAt = updates.opensAt ? new Date(updates.opensAt) : null
    }
    if (updates.closesAt !== undefined) {
      allowedUpdates.closesAt = updates.closesAt ? new Date(updates.closesAt) : null
    }
    // Capacity field
    if (updates.maxCapacity !== undefined) {
      const cap = updates.maxCapacity === null ? null : parseInt(updates.maxCapacity)
      if (cap !== null) {
        // Verify capacity is not less than current participants
        const currentCount = await prisma.linePosition.count({
          where: { lineId },
        })
        if (cap < currentCount) {
          return NextResponse.json(
            { error: `Capacity cannot be less than current participants (${currentCount})` },
            { status: 400 }
          )
        }
      }
      allowedUpdates.maxCapacity = cap
    }
    // Owner fee percentage
    if (typeof updates.ownerFeePercent === "number") {
      allowedUpdates.ownerFeePercent = Math.max(0, Math.min(updates.ownerFeePercent, 50))
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
