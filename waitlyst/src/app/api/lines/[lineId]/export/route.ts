import { NextResponse } from "next/server"
import { auth } from "@/auth"
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
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { lineId } = await params

  // Verify caller is the line owner
  const line = await prisma.line.findUnique({
    where: { id: lineId },
  })

  if (!line) {
    return NextResponse.json({ error: "Line not found" }, { status: 404 })
  }

  if (line.createdById !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

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
        ? "For Sale (Locked)"
        : "For Sale"
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
  const safeName = line.name
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
}
