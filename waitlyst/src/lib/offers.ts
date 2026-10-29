export const OFFER_TTL_MS = 24 * 60 * 60 * 1000

export const MIN_OFFER_AMOUNT = 1

export function offerExpiresAt(createdAt: Date | string): Date {
  return new Date(new Date(createdAt).getTime() + OFFER_TTL_MS)
}

export function isOfferExpired(createdAt: Date | string, now: Date = new Date()): boolean {
  return offerExpiresAt(createdAt) <= now
}
