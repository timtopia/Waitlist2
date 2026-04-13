import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { getPlatformFeePercent } from "@/lib/fees"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const body = await req.json()

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
    // Validate announcement
    const announcement = body.announcement
    if (announcement !== null && announcement !== undefined) {
      if (typeof announcement !== "string") {
        return NextResponse.json({ error: "Announcement must be a string" }, { status: 400 })
      }
      const trimmed = announcement.trim()
      if (trimmed.length > 280) {
        return NextResponse.json({ error: "Announcement must be 280 characters or fewer" }, { status: 400 })
      }
    }

    // Update announcement
    const isClearing = announcement === null || announcement === undefined || announcement.trim() === ""
    const updatedLine = await prisma.line.update({
      where: { id: lineId },
      data: {
        announcement: isClearing ? null : announcement.trim(),
        announcementAt: isClearing ? null : new Date(),
      },
      include: {
        createdBy: { select: { id: true, name: true, image: true } },
        positions: {
          include: { user: { select: { id: true, name: true, image: true } } },
          orderBy: { position: "asc" },
        },
      },
    })

    return NextResponse.json({ ...updatedLine, platformFeePercent: getPlatformFeePercent() })
  } catch (error) {
    console.error("Announcement update error:", error)
    return NextResponse.json({ error: "Failed to update announcement" }, { status: 500 })
  }
}
