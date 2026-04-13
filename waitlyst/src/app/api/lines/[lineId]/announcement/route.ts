import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getPlatformFeePercent } from "@/lib/fees"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = await params
  const body = await req.json()

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
