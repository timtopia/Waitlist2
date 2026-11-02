import Stripe from "stripe"
import { runAfterResponse } from "./after-response"
import type { Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import { sendEmail } from "./email"
import { positionSoldEmail } from "./email-templates"
import { tradeBlocker } from "./trading"

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

/** The PaymentIntent behind a checkout session, whether or not it was expanded. */
export function paymentIntentIdOf(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent
  if (!pi) return null
  return typeof pi === "string" ? pi : pi.id
}

/**
 * Remember which PaymentIntent paid for a transaction, so later events about
 * the charge (refunds, the hold lapsing) can find it without asking Stripe,
 * along with the deadline for collecting the held payment.
 */
export async function recordPaymentIntent(transactionId: string, session: Stripe.Checkout.Session) {
  const paymentIntentId = paymentIntentIdOf(session)
  if (!paymentIntentId) return

  let captureBefore: Date | null = null
  const stripe = getStripe()
  if (stripe) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] })
      const charge = paymentIntent.latest_charge
      const deadline = typeof charge === "object" ? charge?.payment_method_details?.card?.capture_before : undefined
      if (deadline) captureBefore = new Date(deadline * 1000)
    } catch (error) {
      // The deadline is only shown to the owner; don't fail the checkout over it
      console.error(`recordPaymentIntent: couldn't read capture deadline for ${paymentIntentId}:`, error)
    }
  }

  await prisma.transaction.update({
    where: { id: transactionId },
    data: { stripePaymentIntentId: paymentIntentId, ...(captureBefore && { captureBefore }) },
  })
}

/**
 * The site's public URL from the environment, or null when none is set.
 */
export function configuredBaseUrl(): string | null {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null)
  )
}

/**
 * Get the base URL for redirects and links in emails.
 */
export function getBaseUrl(): string {
  return configuredBaseUrl() || "http://localhost:3000"
}

interface Transaction {
  id: string
  stripePaymentId: string | null
}

/**
 * Refund transactions via Stripe and mark them REFUNDED -- but only the ones
 * whose money really went back (or was never taken). A refund Stripe rejects
 * leaves the transaction as it was, so the organizer still sees it as open
 * rather than being told the buyer has their money.
 * Without Stripe (dev mode) nothing was charged, so they're just marked.
 *
 * NOTE: This only changes the status to REFUNDED. It does NOT set settledAt.
 * Settlement (settledAt) is a separate concern — it is set when both parties
 * have left the line, via settleTransactionsForUser().
 *
 * Returns the ids of the transactions that were refunded.
 */
export async function refundTransactions(transactions: Transaction[]): Promise<string[]> {
  const refunded: string[] = []
  const stripe = getStripe()

  for (const txn of transactions) {
    try {
      if (stripe && txn.stripePaymentId) {
        const session = await stripe.checkout.sessions.retrieve(txn.stripePaymentId)
        const paymentIntentId = paymentIntentIdOf(session)
        // No PaymentIntent means the buyer never paid, so there's nothing to
        // give back.
        if (paymentIntentId) {
          try {
            await stripe.refunds.create({ payment_intent: paymentIntentId })
          } catch (stripeError) {
            const code = (stripeError as { code?: string }).code
            if (code !== "charge_already_refunded") throw stripeError
          }
        }
      }

      await prisma.transaction.update({
        where: { id: txn.id },
        data: { status: "REFUNDED" },
      })
      refunded.push(txn.id)
    } catch (error) {
      console.error(`Refund failed for transaction ${txn.id}:`, error)
    }
  }

  return refunded
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
    const paymentIntentId = paymentIntentIdOf(session)
    if (!paymentIntentId) return false

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
    const paymentIntentId = paymentIntentIdOf(session)
    if (!paymentIntentId) return null

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
  opts: { offerId?: string | null; expireSession?: boolean; byBuyer?: boolean } = {}
): Promise<boolean> {
  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } })
  if (!transaction) return false

  const abandoned = await prisma.$transaction(async (tx) => {
    const { count } = await tx.transaction.updateMany({
      where: { id: transactionId, status: "PENDING" },
      data: { status: "FAILED", ...(opts.byBuyer ? { abandonedByBuyer: true } : {}) },
    })
    if (count === 0) return false
    await tx.linePosition.updateMany({
      where: { lockedBy: transactionId },
      data: { lockedUntil: null, lockedBy: null },
    })
    return true
  })
  if (!abandoned) return false

  if (opts.offerId !== null) {
    const reopened = await prisma.swapOffer.updateMany({
      where: { transactionId, status: "ACCEPTED" },
      data: { status: "PENDING", transactionId: null },
    })
    // Checkouts started before offers recorded their transaction only carry
    // the offer id in the Stripe session metadata.
    let offerId: string | null | undefined = opts.offerId
    const stripe = getStripe()
    if (reopened.count === 0 && offerId === undefined && stripe && transaction.stripePaymentId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(transaction.stripePaymentId)
        offerId = session.metadata?.offerId ?? null
      } catch {
        offerId = null
      }
    }
    if (reopened.count === 0 && offerId) {
      await prisma.swapOffer.updateMany({
        where: { id: offerId, status: "ACCEPTED" },
        data: { status: "PENDING", transactionId: null },
      })
    }
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
      const line = await tx.line.findUnique({
        where: { id: lineId },
        select: { nowServingUserId: true },
      })
      const nowServingUserId = line?.nowServingUserId ?? null

      // Either side may have been called up or served while the buyer was
      // on the payment page; that spot isn't for sale any more.
      if (
        !buyerPosition || !sellerPosition ||
        buyerPosition.position !== sellerPosition.position + 1 ||
        tradeBlocker(buyerPosition, nowServingUserId, "yours") ||
        tradeBlocker(sellerPosition, nowServingUserId, "theirs")
      ) {
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
        data: { status: "EXPIRED" },
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

  // Restaurant lines keep the buyer's card on hold until they're seated, so
  // the owner can still release it if the evening goes wrong. Everywhere else
  // the trade is final: collect and pay out now. If collecting fails, the
  // purchase stays open on the settlement page like any other.
  const line = await prisma.line.findUnique({ where: { id: lineId }, select: { kind: true } })
  if (line?.kind !== "RESTAURANT") {
    await releaseAndSettle(transaction)
  }

  // Every completed swap path (direct buy, Stripe return, webhook, offer
  // accept) funnels through here, so this is the one place the seller learns
  // their spot sold -- for a direct buy they'd otherwise never be told.
  runAfterResponse(() => notifySellerOfSale(transaction))

  return true
}

/**
 * Did the buyer actually finish checkout? With manual capture the session's
 * payment_status may stay "unpaid" (funds aren't in the account yet), so also
 * accept a completed session whose PaymentIntent is awaiting capture.
 */
export async function isCheckoutAuthorized(session: Stripe.Checkout.Session): Promise<boolean> {
  if (session.payment_status === "paid") return true
  const paymentIntentId = paymentIntentIdOf(session)
  if (session.status !== "complete" || !paymentIntentId) return false
  const stripe = getStripe()
  if (!stripe) return false
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
  return paymentIntent.status === "requires_capture" || paymentIntent.status === "succeeded"
}

interface ReleasableTransaction {
  id: string
  lineId: string
  /** The line's owner at sale time; outlives the line */
  ownerId?: string | null
  sellerId: string
  amount: number
  ownerFee: number
  stripePaymentId: string | null
}

/** When the buyer's money was collected and when each payee got their share. */
export interface ReleaseResult {
  capturedAt: Date
  sellerPaidAt: Date | null
  ownerPaidAt: Date | null
}

/**
 * Capture the buyer's authorization and pay the seller and line owner.
 * Returns null only when money could not be collected (e.g. the hold
 * expired) -- callers must then NOT mark the transaction settled. A payee
 * with no payout account yet gets a null paid-at, and is paid by
 * payOutstandingPayouts once they finish setup.
 * Without Stripe (dev mode) nothing is really collected; it's all "paid".
 */
export async function releaseFunds(txn: ReleasableTransaction): Promise<ReleaseResult | null> {
  const stripe = getStripe()
  const now = new Date()
  if (!stripe || !txn.stripePaymentId) {
    return { capturedAt: now, sellerPaidAt: now, ownerPaidAt: now }
  }

  try {
    let paymentIntent = await paymentIntentFor(stripe, txn.stripePaymentId)
    if (!paymentIntent) return null
    if (paymentIntent.status === "requires_capture") {
      paymentIntent = await stripe.paymentIntents.capture(paymentIntent.id)
    }
    if (paymentIntent.status !== "succeeded") {
      console.warn(`releaseFunds: payment intent ${paymentIntent.id} is "${paymentIntent.status}", nothing captured`)
      return null
    }

    const paid = await transferPayouts(stripe, txn, paymentIntent)
    return {
      capturedAt: now,
      sellerPaidAt: paid.seller ? now : null,
      ownerPaidAt: paid.owner ? now : null,
    }
  } catch (error) {
    console.error(`releaseFunds failed for transaction ${txn.id}:`, error)
    return null
  }
}

/**
 * Collect a completed purchase and close it out in one step. Returns false
 * if the money couldn't be collected, leaving it open for the organizer.
 */
export async function releaseAndSettle(txn: ReleasableTransaction): Promise<boolean> {
  const released = await releaseFunds(txn)
  if (!released) return false
  await prisma.transaction.update({
    where: { id: txn.id },
    data: { settledAt: released.capturedAt, ...released },
  })
  return true
}

async function paymentIntentFor(stripe: Stripe, sessionId: string): Promise<Stripe.PaymentIntent | null> {
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  const paymentIntentId = paymentIntentIdOf(session)
  if (!paymentIntentId) return null
  return stripe.paymentIntents.retrieve(paymentIntentId)
}

/**
 * Send the seller's take and the owner's fee for a captured payment, unless
 * already sent. Transfers are tagged with transfer_group = transaction id so
 * this is safe to re-run (e.g. when a payee finishes payout setup later).
 * Reports, per payee, whether their share has now reached them (or nothing
 * was owed).
 */
async function transferPayouts(
  stripe: Stripe,
  txn: ReleasableTransaction,
  paymentIntent: Stripe.PaymentIntent
): Promise<{ seller: boolean; owner: boolean }> {
  const chargeId = typeof paymentIntent.latest_charge === "string"
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge?.id
  if (!chargeId) return { seller: false, owner: false }

  const line = await prisma.line.findUnique({
    where: { id: txn.lineId },
    select: { createdById: true },
  })
  // Recorded on the sale, so a deleted line's owner is still paid their fee
  const ownerId = txn.ownerId ?? line?.createdById ?? null
  const payees = await prisma.user.findMany({
    where: { id: { in: [txn.sellerId, ownerId].filter((id): id is string => !!id) } },
    select: { id: true, stripeConnectId: true, stripeConnectOnboarded: true },
  })
  const connectIdOf = (userId: string | undefined) => {
    const user = payees.find((u) => u.id === userId)
    return user?.stripeConnectId && user.stripeConnectOnboarded ? user.stripeConnectId : null
  }

  const existing = await stripe.transfers.list({ transfer_group: txn.id, limit: 10 })
  const alreadySent = (type: string) => existing.data.some((t) => t.metadata?.type === type)

  const send = (type: "seller_payout" | "owner_fee", amount: number, destination: string) =>
    stripe.transfers.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      destination,
      source_transaction: chargeId,
      transfer_group: txn.id,
      metadata: { transactionId: txn.id, type },
    }, {
      // The webhook and the payout-setup redirect can both run this at once;
      // the transfers.list check above can't stop both from sending.
      idempotencyKey: `${txn.id}:${type}`,
    }).then(() => true, (err) => {
      console.error(`${type} transfer failed for transaction ${txn.id}:`, err)
      return false
    })

  // A destination charge already routed the seller's take on capture;
  // transferring it again would pay them twice out of the platform balance.
  let seller = !!paymentIntent.transfer_data?.destination || txn.amount <= 0 || alreadySent("seller_payout")
  const sellerConnectId = connectIdOf(txn.sellerId)
  if (!seller && sellerConnectId) {
    seller = await send("seller_payout", txn.amount, sellerConnectId)
  }

  // An old sale on a deleted line has no owner to pay -- but it mustn't be
  // recorded as paid either.
  if (!ownerId) return { seller, owner: txn.ownerFee <= 0 }
  let owner = ownerId === txn.sellerId || txn.ownerFee <= 0 || alreadySent("owner_fee")
  const ownerConnectId = connectIdOf(ownerId)
  if (!owner && ownerConnectId) {
    owner = await send("owner_fee", txn.ownerFee, ownerConnectId)
  }

  return { seller, owner }
}

/**
 * Catch up payouts for someone who just finished payout setup: any sale or
 * owner fee that was collected while they had nowhere to be paid is sitting
 * in the platform balance and is sent now. Safe to call repeatedly -- only
 * shares not yet marked paid are looked at, and Stripe's transfer_group is
 * checked again before sending.
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
      capturedAt: { not: null },
      stripePaymentId: { not: null },
      OR: [
        { sellerId: userId, sellerPaidAt: null },
        { lineId: { in: ownedLines.map((l) => l.id) }, ownerFee: { gt: 0 }, ownerPaidAt: null },
        // Fees from lines they've since deleted
        { ownerId: userId, ownerFee: { gt: 0 }, ownerPaidAt: null },
      ],
    },
  })

  for (const txn of transactions) {
    try {
      const paymentIntent = await paymentIntentFor(stripe, txn.stripePaymentId!)
      if (paymentIntent?.status !== "succeeded") continue
      const paid = await transferPayouts(stripe, txn, paymentIntent)
      const now = new Date()
      await prisma.transaction.update({
        where: { id: txn.id },
        data: {
          ...(paid.seller && !txn.sellerPaidAt ? { sellerPaidAt: now } : {}),
          ...(paid.owner && !txn.ownerPaidAt ? { ownerPaidAt: now } : {}),
        },
      })
    } catch (error) {
      console.error(`Catch-up payout failed for transaction ${txn.id}:`, error)
    }
  }
}

/**
 * Give a buyer their money back: release the hold if it was never captured
 * (no fees), otherwise issue a real refund. Returns the ids of the purchases
 * that were actually returned; any others are left untouched for the
 * organizer to retry.
 */
export async function returnBuyerFunds(purchases: Transaction[]): Promise<string[]> {
  const needsRefund: Transaction[] = []
  const returned: string[] = []
  for (const purchase of purchases) {
    if (purchase.stripePaymentId && await cancelAuthorization(purchase.stripePaymentId)) {
      await prisma.transaction.update({
        where: { id: purchase.id },
        data: { status: "REFUNDED" },
      })
      returned.push(purchase.id)
      continue
    }
    needsRefund.push(purchase)
  }
  if (needsRefund.length > 0) {
    returned.push(...await refundTransactions(needsRefund))
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
      select: {
        name: true,
        email: true,
        emailNotifications: true,
        stripeConnectId: true,
        stripeConnectOnboarded: true,
      },
    }),
    prisma.linePosition.findUnique({
      where: { lineId_userId: { lineId: transaction.lineId, userId: transaction.sellerId } },
      select: { position: true },
    }),
    prisma.line.findUnique({ where: { id: transaction.lineId }, select: { name: true, kind: true } }),
  ])
  if (!seller?.email || !seller.emailNotifications || !sellerPosition || !line) return

  const { subject, html } = positionSoldEmail(
    seller.name || "there",
    line.name,
    transaction.amount,
    sellerPosition.position,
    `${getBaseUrl()}/lines/${transaction.lineId}`,
    line.kind === "RESTAURANT",
    !!seller.stripeConnectId && seller.stripeConnectOnboarded
  )
  await sendEmail(seller.email, subject, html)
}
