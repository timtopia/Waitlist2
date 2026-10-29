export const OFFER_TTL_MS = 24 * 60 * 60 * 1000

export const MIN_OFFER_AMOUNT = 1

/** When a new (or re-sent) offer made now stops being acceptable. */
export function newOfferExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + OFFER_TTL_MS)
}

export function isOfferExpired(offer: { expiresAt: Date | string }, now: Date = new Date()): boolean {
  return new Date(offer.expiresAt) <= now
}
