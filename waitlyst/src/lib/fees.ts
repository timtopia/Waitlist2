/**
 * Fee calculation utilities.
 *
 * When a position is sold:
 *  - Seller sets their asking price (what they receive)
 *  - Owner fee = askingPrice × ownerFeePercent / 100
 *  - Platform fee = askingPrice × platformFeePercent / 100
 *  - Buyer pays = askingPrice + ownerFee + platformFee
 */

const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT || "5")

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
