const SAME_EVENT_WINDOW_MS = 5000
const MAX_INTERVALS = 10

/**
 * Average minutes between service events, from timestamps of people being
 * served (fulfilled, or their swaps settling as they leave).
 */
export function estimateMinutesPerPerson(timestamps: Date[]): { minutes: number | null; basedOn: number } {
  const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime())
  // Fulfilling someone settles their swaps in the same request, so several
  // timestamps a few seconds apart are one service event, not several.
  const events: Date[] = []
  for (const t of sorted) {
    const last = events[events.length - 1]
    if (!last || t.getTime() - last.getTime() > SAME_EVENT_WINDOW_MS) events.push(t)
  }
  if (events.length < 2) return { minutes: null, basedOn: events.length }

  const intervals: number[] = []
  for (let i = 1; i < events.length; i++) {
    intervals.push(events[i].getTime() - events[i - 1].getTime())
  }
  // Median of the most recent intervals: reflects the current pace and isn't
  // skewed by one long break (e.g. the owner stepping away for an hour).
  const recent = intervals.slice(-MAX_INTERVALS).sort((a, b) => a - b)
  const mid = Math.floor(recent.length / 2)
  const medianMs = recent.length % 2 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2

  return { minutes: Math.round((medianMs / 60000) * 10) / 10, basedOn: events.length }
}

/** "<1 min", "~12 min", "~1 hr", "~3 hrs" */
export function formatWaitTime(minutes: number): string {
  if (minutes < 1) return "<1 min"
  if (minutes < 60) return `~${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 2) return "~1 hr"
  return `~${Math.round(hours)} hrs`
}
