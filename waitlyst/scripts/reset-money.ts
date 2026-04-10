/**
 * Reset all money: refund completed Stripe payments, then delete all transactions.
 *
 * Usage:
 *   npx tsx scripts/reset-money.ts
 *
 * What this does:
 *   1. Refunds all COMPLETED transactions in Stripe (via payment intent)
 *   2. Deletes ALL transaction records from the database
 *   3. Clears all asking prices and position locks
 */

import Stripe from "stripe"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const stripe = stripeKey ? new Stripe(stripeKey) : null

  console.log("=== MONEY RESET SCRIPT ===\n")
  console.log(`Stripe: ${stripe ? "configured ✓" : "not configured (DB-only reset)"}\n`)

  // ── Step 1: Refund all completed Stripe payments ──────────────────────
  const completedTransactions = await prisma.transaction.findMany({
    where: {
      status: "COMPLETED",
      stripePaymentId: { not: null },
    },
  })

  console.log(`Found ${completedTransactions.length} completed transactions with Stripe payments`)

  if (stripe && completedTransactions.length > 0) {
    let refunded = 0
    let skipped = 0
    let failed = 0

    for (const txn of completedTransactions) {
      try {
        // Retrieve the checkout session to get the payment intent
        const session = await stripe.checkout.sessions.retrieve(txn.stripePaymentId!)
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id

        if (paymentIntentId) {
          // Check if already refunded
          const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

          if (paymentIntent.status === "succeeded") {
            await stripe.refunds.create({ payment_intent: paymentIntentId })
            console.log(`  ✓ Refunded txn ${txn.id} (${txn.amount} cents)`)
            refunded++
          } else {
            console.log(`  ⏭ Skipped txn ${txn.id} — payment status: ${paymentIntent.status}`)
            skipped++
          }
        } else {
          console.log(`  ⏭ Skipped txn ${txn.id} — no payment intent found`)
          skipped++
        }
      } catch (err: any) {
        // charge_already_refunded is fine — means it was already refunded
        if (err?.code === "charge_already_refunded") {
          console.log(`  ⏭ Skipped txn ${txn.id} — already refunded in Stripe`)
          skipped++
        } else {
          console.error(`  ✗ Failed to refund txn ${txn.id}:`, err?.message || err)
          failed++
        }
      }
    }

    console.log(`\nStripe refunds: ${refunded} refunded, ${skipped} skipped, ${failed} failed`)
  }

  // ── Step 2: Delete all transactions from the database ─────────────────
  const totalTransactions = await prisma.transaction.count()
  console.log(`\nDeleting ${totalTransactions} transactions from database...`)

  const deleted = await prisma.transaction.deleteMany({})
  console.log(`  ✓ Deleted ${deleted.count} transactions`)

  // ── Step 3: Clear all asking prices and position locks ────────────────
  console.log("\nClearing all asking prices and position locks...")

  const clearedPrices = await prisma.linePosition.updateMany({
    where: { askingPrice: { not: null } },
    data: { askingPrice: null },
  })
  console.log(`  ✓ Cleared ${clearedPrices.count} asking prices`)

  const clearedLocks = await prisma.linePosition.updateMany({
    where: { lockedBy: { not: null } },
    data: { lockedUntil: null, lockedBy: null },
  })
  console.log(`  ✓ Cleared ${clearedLocks.count} position locks`)

  console.log("\n=== RESET COMPLETE ===")
}

main()
  .catch((err) => {
    console.error("Reset failed:", err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
