import Stripe from "stripe"
import type { Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import { sendEmail } from "./email"
import { positionSoldEmail } from "./email-templates"

// Lazy-initialize Stripe to ensure env vars are loaded by Next.js before we read them.
// Module-level `process.env` reads can happen before Next.js injects .env values.
let _stripe: Stripe | null | undefined

export function getStripe(): Stripe | null {
  if (_stripe === undefined) {
    const key = process.env.STRIPE_SECRET_KEY
    _stripe = key ? new Stripe(key) : null
  }
  return _stripe
}


/**
 * Get the base URL for redirects.
 */
export function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000"
}

interface Transaction {
  id: string
  stripePaymentId: string | null
}

/**
 * Refund transactions via Stripe.
 * If Stripe is not configured, just marks them as REFUNDED in the database.
 * If Stripe IS configured, issues actual refunds through the Stripe API.
 *
 * NOTE: This only changes the status to REFUNDED. It does NOT set settledAt.
 * Settlement (settledAt) is a separate concern — it is set when both parties
 * have left the line, via settleTransactionsForUser().
 */
export async function refundTransactions(transactions: Transaction[]): Promise<number> {
  let refundedCount = 0
  const stripe = getStripe()

  for (const txn of transactions) {
    try {
      // If Stripe is configured and we have a session ID, issue a real refund
      if (stripe && txn.stripePaymentId) {
        try {
          // Retrieve the checkout session to get the payment intent
          const session = await stripe.checkout.sessions.retrieve(txn.stripePaymentId)

          if (session.payment_intent) {
            const paymentIntentId = typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent.id

            await stripe.refunds.create({
              payment_intent: paymentIntentId,
            })
          }
        } catch (stripeError) {
          console.error(`Stripe refund failed for transaction ${txn.id}:`, stripeError)
          // Still mark as refunded in DB even if Stripe refund fails
          // (may have already been refunded, or payment never completed)
        }
      }

      await prisma.transaction.update({
        where: { id: txn.id },
        data: { status: "REFUNDED" },
      })
      refundedCount++
    } catch (error) {
      console.error(`Failed to refund transaction ${txn.id}:`, error)
    }
  }

  return refundedCount
}

/**
 * Cancel an authorized (uncaptured) payment intent.
 * Used when removing a position that was never fulfilled — releases the hold
 * on the buyer's card with no charge and no Stripe fees.
 *
 * @param sessionId - The Stripe checkout session ID stored on the transaction
 * @returns true if cancellation succeeded, false if already cancelled/captured
 */
export async function cancelAuthorization(sessionId: string): Promise<boolean> {
  const stripe = getStripe()
  if (!stripe) return false

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (!session.payment_intent) return false

    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent.id

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

    // Only cancel if still in a cancellable state
    if (paymentIntent.status === "requires_capture") {
      await stripe.paymentIntents.cancel(paymentIntentId)
      return true
    }

    // Already cancelled or captured — nothing to do
    if (paymentIntent.status === "canceled") {
      return true
    }

    console.warn(`cancelAuthorization: payment intent ${paymentIntentId} is in unexpected state "${paymentIntent.status}"`)
    return false
  } catch (error) {
    console.error(`cancelAuthorization failed for session ${sessionId}:`, error)
    return false
  }
}

/**
 * Capture an authorized (uncaptured) payment intent.
 * Used when fulfilling a position — actually charges the buyer's card.
 *
 * @param sessionId - The Stripe checkout session ID stored on the transaction
 * @returns The captured amount in cents, or null if capture failed/was already done
 */
export async function captureAuthorization(sessionId: string): Promise<number | null> {
  const stripe = getStripe()
  if (!stripe) return null

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (!session.payment_intent) return null

    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent.id

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

    // Only capture if awaiting capture
    if (paymentIntent.status === "requires_capture") {
      const captured = await stripe.paymentIntents.capture(paymentIntentId)
      return captured.amount
    }

    // Already captured — idempotent success
    if (paymentIntent.status === "succeeded") {
      return paymentIntent.amount
    }

    console.warn(`captureAuthorization: payment intent ${paymentIntentId} is in unexpected state "${paymentIntent.status}"`)
    return null
  } catch (error) {
    console.error(`captureAuthorization failed for session ${sessionId}:`, error)
    return null
  }
}

/**
 * Atomically lock both positions for a checkout. A plain "read lockedUntil,
 * then write it" lets two concurrent checkouts (a direct buy and an offer
 * accept, or a double-click) both see the spots free and both proceed.
 * Returns false if either position is already held by a live lock.
 */
export async function lockPositionsForTransaction(
  tx: Prisma.TransactionClient,
  positionIds: string[],
  transactionId: string,
  lockUntil: Date
): Promise<boolean> {
  const { count } = await tx.linePosition.updateMany({
    where: {
      id: { in: positionIds },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
    },
    data: { lockedUntil: lockUntil, lockedBy: transactionId },
  })
  return count === positionIds.length
}

/** Best-effort: kill a Checkout Session so a stale payment link can't be used. */
export async function expireCheckoutSession(sessionId: string | null | undefined): Promise<void> {
  const stripe = getStripe()
  if (!stripe || !sessionId) return
  try {
    await stripe.checkout.sessions.expire(sessionId)
  } catch {
    // Already expired, completed, or gone.
  }
}

/**
 * Abandon a checkout that was never paid: FAIL it (only if still PENDING, so a
 * late cancel can never undo a completed swap), unlock both spots, kill the
 * Stripe session, and put an accepted offer it came from back to PENDING so
 * neither side is left staring at an "accepted" offer nobody can pay for.
 * Returns true if this call is what abandoned it.
 */
export async function abandonPendingTransaction(
  transactionId: string,
  opts: { offerId?: string | null; expireSession?: boolean } = {}
): Promise<boolean> {
  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } })
  if (!transaction) return false

  const abandoned = await prisma.$transaction(async (tx) => {
    const { count } = await tx.transaction.updateMany({
      where: { id: transactionId, status: "PENDING" },
      data: { status: "FAILED" },
    })
    if (count === 0) return false
    await tx.linePosition.updateMany({
      where: { lockedBy: transactionId },
      data: { lockedUntil: null, lockedBy: null },
    })
    return true
  })
  if (!abandoned) return false

  let offerId = opts.offerId
  const stripe = getStripe()
  if (offerId === undefined && stripe && transaction.stripePaymentId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(transaction.stripePaymentId)
      offerId = session.metadata?.offerId ?? null
    } catch {
      offerId = null
    }
  }
  if (offerId) {
    await prisma.swapOffer.updateMany({
      where: { id: offerId, status: "ACCEPTED" },
      data: { status: "PENDING" },
    })
  }

  if (opts.expireSession !== false) {
    await expireCheckoutSession(transaction.stripePaymentId)
  }
  return true
}

/**
 * Perform a position swap between buyer and seller.
 * Used by the complete-payment callback, the webhook handler and dev mode.
 * Returns true only if THIS call performed the swap. If the swap can't go
 * through (already cancelled, a party left, or the two are no longer
 * adjacent), any authorization the buyer gave is released.
 */
export async function performPositionSwap(transactionId: string): Promise<boolean> {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
  })

  if (!transaction) {
    console.error(`Transaction ${transactionId} not found`)
    return false
  }

  if (transaction.status === "COMPLETED") {
    return false
  }

  const { lineId, buyerId, sellerId } = transaction

  let outcome: "swapped" | "noop" | "failed" = "noop"
  if (transaction.status === "PENDING") {
    outcome = await prisma.$transaction(async (tx) => {
      // Row-lock both spots so concurrent swaps on the same pair (webhook +
      // return URL, or two checkouts) serialize instead of reading the same
      // pre-swap positions and swapping twice -- which would undo the trade.
      await tx.$queryRaw`SELECT id FROM "LinePosition" WHERE "lineId" = ${lineId} AND "userId" IN (${buyerId}, ${sellerId}) ORDER BY id FOR UPDATE`

      const claimed = await tx.transaction.updateMany({
        where: { id: transactionId, status: "PENDING" },
        data: { status: "COMPLETED" },
      })
      if (claimed.count === 0) return "noop" as const

      const buyerPosition = await tx.linePosition.findUnique({
        where: { lineId_userId: { lineId, userId: buyerId } },
      })
      const sellerPosition = await tx.linePosition.findUnique({
        where: { lineId_userId: { lineId, userId: sellerId } },
      })

      if (!buyerPosition || !sellerPosition || buyerPosition.position !== sellerPosition.position + 1) {
        await tx.transaction.update({
          where: { id: transactionId },
          data: { status: "FAILED" },
        })
        await tx.linePosition.updateMany({
          where: { lockedBy: transactionId },
          data: { lockedUntil: null, lockedBy: null },
        })
        return "failed" as const
      }

      // Swap positions using temporary position to avoid unique constraint
      await tx.linePosition.update({
        where: { id: buyerPosition.id },
        data: { position: -1 },
      })

      // Both listings are cleared: each was priced for the spot its owner
      // just left, and carrying the buyer's old (often cheaper) price onto
      // the better spot would let the seller buy it straight back.
      await tx.linePosition.update({
        where: { id: sellerPosition.id },
        data: {
          position: buyerPosition.position,
          askingPrice: null,
          lockedUntil: null,
          lockedBy: null,
        },
      })

      await tx.linePosition.update({
        where: { id: buyerPosition.id },
        data: {
          position: sellerPosition.position,
          askingPrice: null,
          lockedUntil: null,
          lockedBy: null,
        },
      })

      // Every pending offer involving either party referred to an adjacency
      // that no longer exists.
      await tx.swapOffer.updateMany({
        where: {
          lineId,
          status: "PENDING",
          OR: [
            { fromUserId: buyerId },
            { toUserId: buyerId },
            { fromUserId: sellerId },
            { toUserId: sellerId },
          ],
        },
        data: { status: "DECLINED" },
      })

      return "swapped" as const
    })
  }

  if (outcome !== "swapped") {
    if (transaction.stripePaymentId) {
      const latest = await prisma.transaction.findUnique({
        where: { id: transactionId },
        select: { status: true },
      })
      if (latest?.status !== "COMPLETED") {
        await cancelAuthorization(transaction.stripePaymentId)
      }
    }
    return false
  }

  // Every completed swap path (direct buy, Stripe return, webhook, offer
  // accept) funnels through here, so this is the one place the seller learns
  // their spot sold -- for a direct buy they'd otherwise never be told.
  notifySellerOfSale(transaction).catch(() => {})

  return true
}

/**
 * Did the buyer actually finish checkout? With manual capture the session's
 * payment_status may stay "unpaid" (funds aren't in the account yet), so also
 * accept a completed session whose PaymentIntent is awaiting capture.
 */
export async function isCheckoutAuthorized(session: Stripe.Checkout.Session): Promise<boolean> {
  if (session.payment_status === "paid") return true
  if (session.status !== "complete" || !session.payment_intent) return false
  const stripe = getStripe()
  if (!stripe) return false
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent.id
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
  return paymentIntent.status === "requires_capture" || paymentIntent.status === "succeeded"
}

interface ReleasableTransaction {
  id: string
  lineId: string
  sellerId: string
  amount: number
  ownerFee: number
  stripePaymentId: string | null
}

/**
 * Capture the buyer's authorization and pay the seller and line owner.
 * Returns false only when money could not be collected (e.g. the hold
 * expired) -- callers must then NOT mark the transaction settled.
 * Without Stripe (dev mode) there is nothing to collect, so it's a success.
 */
export async function releaseFunds(txn: ReleasableTransaction): Promise<boolean> {
  const stripe = getStripe()
  if (!stripe || !txn.stripePaymentId) return true

  try {
    const session = await stripe.checkout.sessions.retrieve(txn.stripePaymentId)
    if (!session.payment_intent) return false
    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent.id

    let paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
    if (paymentIntent.status === "requires_capture") {
      paymentIntent = await stripe.paymentIntents.capture(paymentIntentId)
    }
    if (paymentIntent.status !== "succeeded") {
      console.warn(`releaseFunds: payment intent ${paymentIntentId} is "${paymentIntent.status}", nothing captured`)
      return false
    }

    await transferPayouts(stripe, txn, paymentIntent)
    return true
  } catch (error) {
    console.error(`releaseFunds failed for transaction ${txn.id}:`, error)
    return false
  }
}

/**
 * Send the seller's take and the owner's fee for a captured payment, unless
 * already sent. Transfers are tagged with transfer_group = transaction id so
 * this is safe to re-run (e.g. when a payee finishes payout setup later).
 */
async function transferPayouts(stripe: Stripe, txn: ReleasableTransaction, paymentIntent: Stripe.PaymentIntent) {
  const chargeId = typeof paymentIntent.latest_charge === "string"
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge?.id
  if (!chargeId) return

  const line = await prisma.line.findUnique({
    where: { id: txn.lineId },
    select: { createdById: true },
  })
  const payees = await prisma.user.findMany({
    where: { id: { in: [txn.sellerId, line?.createdById].filter((id): id is string => !!id) } },
    select: { id: true, stripeConnectId: true, stripeConnectOnboarded: true },
  })
  const connectIdOf = (userId: string | undefined) => {
    const user = payees.find((u) => u.id === userId)
    return user?.stripeConnectId && user.stripeConnectOnboarded ? user.stripeConnectId : null
  }

  const existing = await stripe.transfers.list({ transfer_group: txn.id, limit: 10 })
  const alreadySent = (type: string) => existing.data.some((t) => t.metadata?.type === type)

  // A destination charge already routed the seller's take on capture;
  // transferring it again would pay them twice out of the platform balance.
  const sellerConnectId = connectIdOf(txn.sellerId)
  if (!paymentIntent.transfer_data?.destination && sellerConnectId && txn.amount > 0 && !alreadySent("seller_payout")) {
    await stripe.transfers.create({
      amount: Math.round(txn.amount * 100),
      currency: "usd",
      destination: sellerConnectId,
      source_transaction: chargeId,
      transfer_group: txn.id,
      metadata: { transactionId: txn.id, type: "seller_payout" },
    }).catch((err) => console.error(`Seller payout failed for transaction ${txn.id}:`, err))
  }

  const ownerConnectId = connectIdOf(line?.createdById)
  if (line && line.createdById !== txn.sellerId && ownerConnectId && txn.ownerFee > 0 && !alreadySent("owner_fee")) {
    await stripe.transfers.create({
      amount: Math.round(txn.ownerFee * 100),
      currency: "usd",
      destination: ownerConnectId,
      source_transaction: chargeId,
      transfer_group: txn.id,
      metadata: { transactionId: txn.id, type: "owner_fee" },
    }).catch((err) => console.error(`Owner fee transfer failed for transaction ${txn.id}:`, err))
  }
}

/**
 * Catch up payouts for someone who just finished payout setup: any sale or
 * owner fee that was captured while they had nowhere to be paid is sitting
 * in the platform balance and is sent now.
 */
export async function payOutstandingPayouts(userId: string): Promise<void> {
  const stripe = getStripe()
  if (!stripe) return

  const ownedLines = await prisma.line.findMany({
    where: { createdById: userId },
    select: { id: true },
  })
  const transactions = await prisma.transaction.findMany({
    where: {
      status: "COMPLETED",
      settledAt: { not: null },
      stripePaymentId: { not: null },
      OR: [
        { sellerId: userId },
        { lineId: { in: ownedLines.map((l) => l.id) }, ownerFee: { gt: 0 } },
      ],
    },
  })

  for (const txn of transactions) {
    try {
      const session = await stripe.checkout.sessions.retrieve(txn.stripePaymentId!)
      if (!session.payment_intent) continue
      const paymentIntentId = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent.id
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
      if (paymentIntent.status !== "succeeded") continue
      await transferPayouts(stripe, txn, paymentIntent)
    } catch (error) {
      console.error(`Catch-up payout failed for transaction ${txn.id}:`, error)
    }
  }
}

/**
 * Give an unfulfilled buyer their money back: release the hold if it was
 * never captured (no fees), otherwise issue a real refund.
 */
export async function returnBuyerFunds(purchases: Transaction[]): Promise<number> {
  const needsRefund: Transaction[] = []
  let returned = 0
  for (const purchase of purchases) {
    if (purchase.stripePaymentId && await cancelAuthorization(purchase.stripePaymentId)) {
      await prisma.transaction.update({
        where: { id: purchase.id },
        data: { status: "REFUNDED" },
      })
      returned++
      continue
    }
    needsRefund.push(purchase)
  }
  if (needsRefund.length > 0) {
    returned += await refundTransactions(needsRefund)
  }
  return returned
}

async function notifySellerOfSale(transaction: {
  lineId: string
  sellerId: string
  amount: number
}) {
  const [seller, sellerPosition, line] = await Promise.all([
    prisma.user.findUnique({
      where: { id: transaction.sellerId },
      select: { name: true, email: true, emailNotifications: true },
    }),
    prisma.linePosition.findUnique({
      where: { lineId_userId: { lineId: transaction.lineId, userId: transaction.sellerId } },
      select: { position: true },
    }),
    prisma.line.findUnique({ where: { id: transaction.lineId }, select: { name: true } }),
  ])
  if (!seller?.email || !seller.emailNotifications || !sellerPosition || !line) return

  const { subject, html } = positionSoldEmail(
    seller.name || "there",
    line.name,
    transaction.amount,
    sellerPosition.position,
    `${getBaseUrl()}/lines/${transaction.lineId}`
  )
  await sendEmail(seller.email, subject, html)
}
