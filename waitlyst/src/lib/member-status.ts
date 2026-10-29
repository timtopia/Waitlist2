/**
 * Where the viewer stands in a line, and what changed between two snapshots
 * of it -- drives the status card, tab title, toasts and browser
 * notifications for people waiting in line.
 */

export type MemberPhase = "waiting" | "next" | "called" | "served"

export interface StatusLine {
  isActive: boolean
  nowServing: string | null
  announcement: string | null
  announcementAt: string | null
  positions: {
    position: number
    fulfilled: boolean
    user: { id: string; name: string | null }
  }[]
}

export interface MemberStatus {
  phase: MemberPhase
  position: number
  /** People ahead who haven't been served yet */
  ahead: number
}

// Mirrors the name call-next writes into Line.nowServing. The line only
// stores the called person's display name, not their id.
export function nowServingNameFor(userName: string | null): string {
  return userName || "Next person"
}

export function getMemberPhase(input: {
  fulfilled: boolean
  ahead: number
  nowServing: string | null
  userName: string | null
}): MemberPhase {
  if (input.fulfilled) return "served"
  if (input.ahead === 0) {
    return input.nowServing !== null && input.nowServing === nowServingNameFor(input.userName)
      ? "called"
      : "next"
  }
  return "waiting"
}

export function getMemberStatus(line: StatusLine, userId: string | undefined): MemberStatus | null {
  if (!userId) return null
  const mine = line.positions.find((p) => p.user.id === userId)
  if (!mine) return null
  const ahead = line.positions.filter((p) => p.position < mine.position && !p.fulfilled).length
  return {
    phase: getMemberPhase({ fulfilled: mine.fulfilled, ahead, nowServing: line.nowServing, userName: mine.user.name }),
    position: mine.position,
    ahead,
  }
}

export type MemberEvent =
  | { kind: "called" }
  | { kind: "next" }
  | { kind: "served" }
  | { kind: "moved"; from: number; to: number }
  | { kind: "removed"; wasServed: boolean }
  | { kind: "announcement"; text: string }
  | { kind: "paused" }
  | { kind: "resumed" }

/** Changes that matter to someone waiting in line, oldest snapshot first. */
export function diffMemberStatus(prev: StatusLine, next: StatusLine, userId: string | undefined): MemberEvent[] {
  const before = getMemberStatus(prev, userId)
  const after = getMemberStatus(next, userId)
  if (!before && !after) return []

  if (before && !after) {
    return [{ kind: "removed", wasServed: before.phase === "served" || before.phase === "called" }]
  }
  if (!after) return []

  const events: MemberEvent[] = []
  if (before) {
    if (after.phase !== before.phase) {
      if (after.phase === "called") events.push({ kind: "called" })
      else if (after.phase === "served") events.push({ kind: "served" })
      else if (after.phase === "next") events.push({ kind: "next" })
    }
    if (after.position < before.position && after.phase === "waiting") {
      events.push({ kind: "moved", from: before.position, to: after.position })
    }
    if (prev.isActive && !next.isActive) events.push({ kind: "paused" })
    if (!prev.isActive && next.isActive) events.push({ kind: "resumed" })
  }

  const announcementChanged = next.announcement && next.announcementAt !== prev.announcementAt
  // Calling someone also posts an announcement; the "called" event already covers it for them.
  if (announcementChanged && !events.some((e) => e.kind === "called")) {
    events.push({ kind: "announcement", text: next.announcement! })
  }

  return events
}

export interface MemberAlert {
  title: string
  body: string
  /** Also show an in-page toast, not just a browser notification */
  toast: boolean
  tone: "success" | "info" | "warning"
}

const MOVED_ALERT_THRESHOLD = 5

/** What (if anything) to tell the person about an event. */
export function describeMemberEvent(event: MemberEvent, lineName: string): MemberAlert | null {
  switch (event.kind) {
    case "called":
      return { title: "It's your turn!", body: `${lineName}: head to the front now.`, toast: true, tone: "success" }
    case "next":
      return { title: "You're next", body: `You're at the front of ${lineName}. Get ready.`, toast: true, tone: "info" }
    case "served":
      return { title: "You've been served", body: `${lineName} marked you as served.`, toast: true, tone: "success" }
    case "moved":
      // Every shuffle in a long line would be noise; only alert near the front.
      if (event.to > MOVED_ALERT_THRESHOLD) return null
      return { title: `You're #${event.to}`, body: `You moved up in ${lineName}.`, toast: false, tone: "info" }
    case "removed":
      return event.wasServed
        ? { title: "All done", body: `You've left ${lineName} after being served.`, toast: true, tone: "info" }
        : { title: "You're no longer in line", body: `The organizer removed you from ${lineName}.`, toast: true, tone: "warning" }
    case "announcement":
      return { title: `Update from ${lineName}`, body: event.text, toast: false, tone: "info" }
    case "paused":
      return { title: "Line paused", body: `${lineName} is paused. You keep your place.`, toast: false, tone: "info" }
    case "resumed":
      return { title: "Line resumed", body: `${lineName} is moving again.`, toast: false, tone: "info" }
  }
}

/** Browser-tab title while in line, so the place is visible from other tabs. */
export function memberTabTitle(status: MemberStatus | null, lineName: string): string | null {
  if (!status) return null
  if (status.phase === "called") return `Your turn! · ${lineName}`
  if (status.phase === "served") return `Served · ${lineName}`
  return `#${status.position} · ${lineName}`
}
