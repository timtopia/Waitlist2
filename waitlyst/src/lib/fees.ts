/**
 * Fee calculation utilities.
 *
 * When a position is sold, the buyer pays:
 *   askingPrice + ownerFee + platformFee
 *
 * Stripe's processing fee (2.9% + $0.30) comes out of the platform fee.
 * Set PLATFORM_FEE_PERCENT high enough to cover Stripe + your margin.
 * e.g. 10% platform fee → ~3% to Stripe, ~7% profit.
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
