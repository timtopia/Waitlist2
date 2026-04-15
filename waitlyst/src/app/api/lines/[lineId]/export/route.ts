import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

function escapeCsvField(value: string): string {
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
          select: { name: true, email: true },
        },
      },
      orderBy: { position: "asc" },
    })

    // Build CSV
    const headers = ["Position", "Name", "Email", "Joined At", "Asking Price", "Status"]
    const rows = positions.map((pos) => {
      const name = pos.user.name || "Anonymous"
      const email = pos.user.email || ""
      const joinedAt = new Date(pos.joinedAt).toISOString()
      const askingPrice = pos.askingPrice !== null ? `$${pos.askingPrice.toFixed(2)}` : ""
      const isLocked = pos.lockedUntil && new Date(pos.lockedUntil) > new Date()
      const status = pos.askingPrice !== null
        ? isLocked
          ? "Open to Swap (Locked)"
          : "Open to Swap"
        : "In Line"

      return [
        String(pos.position),
        escapeCsvField(name),
        escapeCsvField(email),
        joinedAt,
        askingPrice,
        status,
      ].join(",")
    })

    const csv = [headers.join(","), ...rows].join("\n")

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
