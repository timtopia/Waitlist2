/**
 * Shared formatting utilities for dates, times, and currency.
 */

/** Relative time: "just now", "5m ago", "2h ago", "3d ago", "Jan 5" */
export function timeAgo(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** Countdown: "2d 5h 30m", "1h 15m 30s", "45s" */
export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "0s"

  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((ms % (1000 * 60)) / 1000)

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/** Drop countdown: "2:15:30", "15:30", "0:45" */
export function formatDropCountdown(ms: number): string {
  if (ms <= 0) return "0:00"
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((ms % (1000 * 60)) / 1000)
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/** Date: "Jan 5, 2025" */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

/**
 * Date + time: "Jan 5, 2:30 PM". withZone adds "PST", for times people
 * copy and share with others who may be in another time zone.
 */
export function formatDateTime(iso: string, opts: { withZone?: boolean } = {}): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(opts.withZone && { timeZoneName: "short" }),
  })
}

/** How long someone has waited: "45 min", "2 hr 15 min" */
export function formatWaited(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)} hr${rest ? ` ${rest} min` : ""}`
}

/** Currency: "$25.00" or "$1,234.56" */
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
export function formatCurrency(amount: number): string {
  return usd.format(amount)
}
