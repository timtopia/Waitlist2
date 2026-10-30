interface CapacityFields {
  maxCapacity: number | null
  hideCapacity: boolean
  createdById: string
}

export interface CapacityView {
  /** The real limit, or null when there is none or it's hidden from this viewer */
  maxCapacity: number | null
  hasCapacityLimit: boolean
  isFull: boolean
  /** How much of the capacity is used (see capacityUsed) */
  capacityUsed: number
}

/**
 * What a viewer may know about a line's capacity. When the owner hides it,
 * everyone else gets only whether the line is full -- the number itself
 * never leaves the server.
 */
export function capacityView(
  line: CapacityFields,
  used: number,
  viewerId: string | null = null
): CapacityView {
  const hasCapacityLimit = line.maxCapacity !== null
  const hidden = line.hideCapacity && viewerId !== line.createdById
  return {
    maxCapacity: hidden ? null : line.maxCapacity,
    hasCapacityLimit,
    isFull: line.maxCapacity !== null && used >= line.maxCapacity,
    capacityUsed: used,
  }
}

/**
 * How much of a line's capacity is used:
 * - Restaurant lines count the guests still waiting. A seated party has its
 *   table, so it stops holding a place on the list even before the host
 *   clears it.
 * - Other lines count everyone admitted: people in line, served or not, plus
 *   served people already cleared (servedAndCleared). A 100-spot drop stays
 *   at 100 when the owner clears the served -- otherwise clearing would let
 *   more people in than there is stock for. People who leave or are removed
 *   without being served do free their spot.
 */
export function capacityUsed(
  kind: LineKind,
  positions: { partySize?: number | null; fulfilled?: boolean }[],
  servedAndCleared = 0
): number {
  if (kind === "RESTAURANT") {
    return positions.reduce((sum, p) => sum + (p.fulfilled ? 0 : p.partySize ?? 1), 0)
  }
  return positions.length + servedAndCleared
}

/** Largest party a restaurant line will seat from one spot in the queue. */
export const MAX_PARTY_SIZE = 20

type LineKind = "STANDARD" | "RESTAURANT"

/** What capacity counts on this kind of line: guests at a restaurant, spots elsewhere. */
export function capacityUnit(kind: LineKind | undefined, count: number): string {
  const unit = kind === "RESTAURANT" ? "guest" : "spot"
  return count === 1 ? unit : `${unit}s`
}

/**
 * How much of a line's capacity is taken. Capacity counts guests, and every
 * spot on a STANDARD line is a party of one, so there it's just the number
 * of spots.
 */
export function guestCount(positions: { partySize?: number | null }[]): number {
  return positions.reduce((sum, p) => sum + (p.partySize ?? 1), 0)
}

/**
 * Validate a party size from a request. STANDARD lines are always parties of
 * one; restaurant lines take 1 to MAX_PARTY_SIZE.
 */
export function parsePartySize(kind: LineKind, value: unknown): number | { error: string } {
  if (kind !== "RESTAURANT") return 1
  if (value === undefined || value === null) return 1
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return { error: "Party size must be a whole number of at least 1" }
  }
  if (value > MAX_PARTY_SIZE) {
    return { error: `Parties of more than ${MAX_PARTY_SIZE} can't join this line` }
  }
  return value
}
