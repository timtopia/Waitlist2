export type LineStatus = "open" | "upcoming" | "closed" | "full"

interface LineWithSchedule {
  opensAt?: string | null
  closesAt?: string | null
  maxCapacity?: number | null
  _count: { positions: number }
}

export function getLineStatus(line: LineWithSchedule): LineStatus {
  const now = new Date()
  if (line.opensAt && now < new Date(line.opensAt)) return "upcoming"
  if (line.closesAt && now > new Date(line.closesAt)) return "closed"
  if (line.maxCapacity && line._count.positions >= line.maxCapacity) return "full"
  return "open"
}

const statusStyles: Record<LineStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-green-100 text-green-700" },
  upcoming: { label: "Upcoming", className: "bg-amber-100 text-amber-700" },
  closed: { label: "Closed", className: "bg-red-100 text-red-700" },
  full: { label: "Full", className: "bg-red-100 text-red-700" },
}

export function getStatusBadge(line: LineWithSchedule) {
  return statusStyles[getLineStatus(line)]
}
