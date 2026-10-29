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
}

/**
 * What a viewer may know about a line's capacity. When the owner hides it,
 * everyone else gets only whether the line is full -- the number itself
 * never leaves the server.
 */
export function capacityView(
  line: CapacityFields,
  positionCount: number,
  viewerId: string | null = null
): CapacityView {
  const hasCapacityLimit = line.maxCapacity !== null
  const hidden = line.hideCapacity && viewerId !== line.createdById
  return {
    maxCapacity: hidden ? null : line.maxCapacity,
    hasCapacityLimit,
    isFull: line.maxCapacity !== null && positionCount >= line.maxCapacity,
  }
}
