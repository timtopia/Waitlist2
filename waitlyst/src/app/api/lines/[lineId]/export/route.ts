import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

function escapeCsvField(value: string): string {
  // Spreadsheets run a cell starting with = + - @ (or a tab/CR) as a formula,
  // and names come from people's Google accounts. A leading apostrophe makes
  // it plain text.
  if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// Export line positions as CSV (owner only)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
    // Fetch all positions with user info, ordered by position
    const positions = await prisma.linePosition.findMany({
      where: { lineId },
      include: {
        user: {
          select: { name: true, email: true, isWalkIn: true },
        },
      },
      orderBy: { position: "asc" },
    })

    // Build CSV
    const isRestaurant = result.line.kind === "RESTAURANT"
    const headers = [
      "Position", "Name", "Email", ...(isRestaurant ? ["Party Size", "Note"] : []),
      "Joined At", "Called At", "Served At", "Asking Price", "Status",
    ]
    const rows = positions.map((pos) => {
      const name = pos.user.name || "Anonymous"
      // Walk-ins were added by the host and have no email
      const email = pos.user.isWalkIn ? "(walk-in)" : pos.user.email || ""
      const joinedAt = new Date(pos.joinedAt).toISOString()
      const askingPrice = pos.askingPrice !== null ? `$${pos.askingPrice.toFixed(2)}` : ""
      const isLocked = pos.lockedUntil && new Date(pos.lockedUntil) > new Date()
      const status = pos.fulfilled
        ? isRestaurant ? "Seated" : "Served"
        : pos.calledAt
          ? "Called"
          : pos.askingPrice !== null
            ? isLocked ? "Open to Swap (Locked)" : "Open to Swap"
            : "Waiting"

      return [
        String(pos.position),
        escapeCsvField(name),
        escapeCsvField(email),
        ...(isRestaurant ? [String(pos.partySize), escapeCsvField(pos.note ?? "")] : []),
        joinedAt,
        pos.calledAt ? new Date(pos.calledAt).toISOString() : "",
        pos.fulfilledAt ? new Date(pos.fulfilledAt).toISOString() : "",
        askingPrice,
        status,
      ].join(",")
    })

    // Everyone who already left the list -- served and cleared, left, removed
    // or skipped -- so the export is still a full record after clearing or
    // closing the line.
    const visits = await prisma.queueVisit.findMany({
      where: { lineId },
      include: { user: { select: { name: true, email: true, isWalkIn: true } } },
      orderBy: { exitedAt: "asc" },
    })
    const outcomeLabel = {
      SERVED: isRestaurant ? "Seated" : "Served",
      LEFT: "Left",
      REMOVED: "Removed",
      NO_SHOW: "No-show",
    } as const
    const pastRows = visits.map((v) => [
      `(${v.position})`,
      escapeCsvField(v.user.name || "Anonymous"),
      escapeCsvField(v.user.isWalkIn ? "(walk-in)" : v.user.email || ""),
      ...(isRestaurant ? [String(v.partySize), ""] : []),
      v.joinedAt.toISOString(),
      v.calledAt ? v.calledAt.toISOString() : "",
      v.servedAt ? v.servedAt.toISOString() : "",
      "",
      `${outcomeLabel[v.outcome]} (no longer in line)`,
    ].join(","))

    const csv = [headers.join(","), ...rows, ...pastRows].join("\n")

    // Sanitize line name for filename
    const safeName = result.line.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${safeName}-export.csv"`,
      },
    })
  } catch (error) {
    console.error("Export error:", error)
    return new Response("Something went wrong while exporting. Please try again.", {
      status: 500,
    })
  }
}
