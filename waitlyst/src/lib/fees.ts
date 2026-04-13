/**
 * Fee calculation utilities.
 *
 * When a position is sold, the buyer pays:
 *   askingPrice + ownerFee + platformFee
 *
 * Stripe's processing fees come out of the platform's share.
 */

const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT || "10")

export function getPlatformFeePercent(): number {
  return PLATFORM_FEE_PERCENT
}

export function calculateFees(askingPrice: number, ownerFeePercent: number) {
  const platformFeePercent = getPlatformFeePercent()
  const ownerFee = Math.round(askingPrice * ownerFeePercent) / 100
  const platformFee = Math.round(askingPrice * platformFeePercent) / 100
  const totalPrice = askingPrice + ownerFee + platformFee

  return {
    askingPrice,
    ownerFee,
    platformFee,
    ownerFeePercent,
    platformFeePercent,
    totalPrice,
  }
}

/** Client-safe fee calculator (no env vars). Works on both server and client. */
export function calcFees(price: number, ownerFeePercent: number, platformFeePercent: number) {
  if (!price) return { ownerFee: 0, platformFee: 0, total: price }
  const ownerFee = Math.round(price * ownerFeePercent) / 100
  const platformFee = Math.round(price * platformFeePercent) / 100
  return { ownerFee, platformFee, total: price + ownerFee + platformFee }
}
