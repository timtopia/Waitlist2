import { NextResponse } from "next/server"
import { requireLineOwner } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { buyerTotal } from "@/lib/fees"

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

function money(value: number): string {
  return `$${value.toFixed(2)}`
}

function safeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function swapStatus(txn: { status: string; holdExpiredAt: Date | null; capturedAt: Date | null; settledAt: Date | null }): string {
  if (txn.holdExpiredAt) return "Hold expired"
  switch (txn.status) {
    case "PENDING": return "Awaiting payment"
    case "FAILED": return "Failed"
    case "REFUNDED": return "Refunded"
    default:
      if (txn.capturedAt) return "Collected"
      return txn.settledAt ? "Released" : "Held"
  }
}

/** Every swap on the line, for the owner's own bookkeeping */
async function exportSwaps(lineId: string, lineName: string): Promise<Response> {
  const transactions = await prisma.transaction.findMany({
    where: { lineId },
    orderBy: { createdAt: "asc" },
  })

  const userIds = new Set<string>()
  for (const txn of transactions) {
    userIds.add(txn.buyerId)
    userIds.add(txn.sellerId)
  }
  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(userIds) } },
    select: { id: true, name: true },
  })
  const nameOf = new Map(users.map((u) => [u.id, u.name || "Anonymous"]))

  const headers = [
    "Date", "Buyer", "Seller", "Amount", "Your Fee", "Platform Fee",
    "Buyer Paid", "Status", "Collected At", "Fee Paid Out",
  ]
  const rows = transactions.map((txn) => [
    txn.createdAt.toISOString(),
    escapeCsvField(nameOf.get(txn.buyerId) || "Anonymous"),
    escapeCsvField(nameOf.get(txn.sellerId) || "Anonymous"),
    money(txn.amount),
    money(txn.ownerFee),
    money(txn.platformFee),
    money(buyerTotal(txn)),
    swapStatus(txn),
    txn.capturedAt ? txn.capturedAt.toISOString() : "",
    txn.ownerPaidAt ? txn.ownerPaidAt.toISOString() : "",
  ].join(","))

  const csv = [headers.join(","), ...rows].join("\n")
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${safeFileName(lineName)}-swaps.csv"`,
    },
  })
}

// Export line positions as CSV (owner only). ?type=swaps exports the line's
// swap transactions instead.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  const result = await requireLineOwner(lineId)
  if (result instanceof NextResponse) return result

  try {
    if (new URL(req.url).searchParams.get("type") === "swaps") {
      return await exportSwaps(lineId, result.line.name)
    }

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

    const csv = [headers.join(","), ...rows].join("\n")

    // Sanitize line name for filename
    const safeName = safeFileName(result.line.name)

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
