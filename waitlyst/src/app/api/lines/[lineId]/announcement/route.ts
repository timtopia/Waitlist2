import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { getPlatformFeePercent } from "@/lib/fees"
import { cleanText } from "@/lib/validate"
import { rateLimit } from "@/lib/rate-limit"

// Every new announcement notifies everyone in the line, so a script can't
// be allowed to post one a second.
const announceLimiter = rateLimit({ interval: 60_000, limit: 10 })

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  if (!announceLimiter.check(`announce:${result.userId}`).success) {
    return NextResponse.json(
      { error: "Too many announcement changes. Please wait a minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

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
    const cleaned = typeof announcement === "string" ? cleanText(announcement) : ""
    const isClearing = cleaned === ""
    // Saving the same text again (a second device, or Save pressed twice)
    // mustn't stamp it as new: every guest would be alerted to it again
    const unchanged = !isClearing && cleaned === result.line?.announcement
    const updatedLine = await prisma.line.update({
      where: { id: lineId },
      data: {
        announcement: isClearing ? null : cleaned,
        announcementAt: isClearing ? null : unchanged ? undefined : new Date(),
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
    return NextResponse.json(
      { error: "Something went wrong while updating the announcement. Please try again." },
      { status: 500 }
    )
  }
}
