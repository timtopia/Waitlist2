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

/**
 * "2026-11-03 19:00:00" in UTC: spreadsheets read it as a date/time (raw ISO
 * with a "T" and "Z" stays text), and the column headers say it's UTC.
 */
function ts(value: Date | string | null | undefined): string {
  if (!value) return ""
  return new Date(value).toISOString().slice(0, 19).replace("T", " ")
}

/**
 * A byte-order mark so Excel reads the file as UTF-8 -- otherwise names like
 * José or 王 come out garbled.
 */
function csvResponse(csv: string, fileName: string): Response {
  return new Response(String.fromCharCode(0xfeff) + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  })
}

function money(value: number): string {
  return `$${value.toFixed(2)}`
}

function safeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "line" // a name with no Latin letters used to give "-export.csv"
}

function swapStatus(txn: { status: string; holdExpiredAt: Date | null; capturedAt: Date | null; settledAt: Date | null }): string {
  if (txn.holdExpiredAt) return "Hold expired"
  switch (txn.status) {
    case "PENDING": return "Awaiting payment"
    case "FAILED": return "Failed"
    // A cancelled hold is marked REFUNDED too, but the buyer was never charged:
    // "Refunded" sent owners hunting Stripe for refunds that don't exist
    case "REFUNDED": return txn.capturedAt ? "Refunded" : "Hold released (not charged)"
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
    "Date (UTC)", "Buyer", "Seller", "Amount", "Your Fee", "Platform Fee",
    "Buyer Paid", "Status", "Collected At (UTC)", "Fee Paid Out (UTC)", "Fee Earned",
  ]
  const rows = transactions.map((txn) => {
    const status = swapStatus(txn)
    return [
    ts(txn.createdAt),
    escapeCsvField(nameOf.get(txn.buyerId) || "Anonymous"),
    escapeCsvField(nameOf.get(txn.sellerId) || "Anonymous"),
    money(txn.amount),
    money(txn.ownerFee),
    money(txn.platformFee),
    money(buyerTotal(txn)),
    status,
    ts(txn.capturedAt),
    ts(txn.ownerPaidAt),
    // "Your Fee" is what the swap was quoted at; only a collected swap
    // actually earned it, so summing this column matches your payouts
    money(status === "Collected" ? txn.ownerFee : 0),
  ].join(",")
  })

  const csv = [headers.join(","), ...rows].join("\n")
  return csvResponse(csv, `${safeFileName(lineName)}-swaps.csv`)
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
      "Joined At (UTC)", "Called At (UTC)", `${isRestaurant ? "Seated" : "Served"} At (UTC)`, "Asking Price", "Status",
    ]
    const rows = positions.map((pos) => {
      const name = pos.user.name || "Anonymous"
      // Walk-ins were added by the host and have no email
      const email = pos.user.isWalkIn ? "(walk-in)" : pos.user.email || ""
      const joinedAt = ts(pos.joinedAt)
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
        ts(pos.calledAt),
        ts(pos.fulfilledAt),
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
      ts(v.joinedAt),
      ts(v.calledAt),
      ts(v.servedAt),
      "",
      `${outcomeLabel[v.outcome]} (no longer in line)`,
    ].join(","))

    const csv = [headers.join(","), ...rows, ...pastRows].join("\n")

    // Sanitize line name for filename
    const safeName = safeFileName(result.line.name)

    return csvResponse(csv, `${safeName}-export.csv`)
  } catch (error) {
    console.error("Export error:", error)
    return new Response("Something went wrong while exporting. Please try again.", {
      status: 500,
    })
  }
}
