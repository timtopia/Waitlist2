# Development Log - January 25, 2026

## Session Summary
Continued development on Waitlyst - a queue position trading platform.

---

## Features Implemented

### 1. Position Locking System
Prevents conflicting swaps during transactions (e.g., positions 1-2 and 2-3 can't swap simultaneously, but 4-5 can).

**Files Modified:**
- `prisma/schema.prisma` - Added `lockedUntil` and `lockedBy` fields to LinePosition
- `src/app/api/lines/[lineId]/checkout/route.ts` - Locks both positions during checkout (10-minute duration)
- `src/app/api/lines/[lineId]/cancel-payment/route.ts` - Unlocks positions on cancel

**How it works:**
- When a checkout starts, both buyer and seller positions are locked with a `lockedUntil` timestamp and `lockedBy` transaction ID
- Other users cannot buy positions that are locked
- Locks expire after 10 minutes or when payment completes/cancels

---

### 2. Owner Priority Over Purchases
Line owners can remove anyone even during pending transactions. The transaction is cancelled and automatically refunded.

**Files Modified:**
- `src/app/api/lines/[lineId]/remove-position/route.ts` - Cancels pending transactions when owner removes someone
- `src/app/api/lines/[lineId]/remove-front/route.ts` - Same logic for removing front person
- `src/app/api/lines/[lineId]/complete-payment/route.ts` - Auto-refunds if transaction was marked FAILED

**How it works:**
- If owner removes someone mid-purchase, transaction status is set to FAILED
- When buyer returns from Stripe checkout, they see the refund message
- Stripe refund is issued automatically

---

### 3. Payment Tracking with Payout/Refund Options
When removing someone, owners can choose to finalize transactions (payout) or refund all purchases.

**Files Created:**
- `src/app/api/lines/[lineId]/position-transactions/route.ts` - Gets transaction history for a user
- `src/app/api/lines/[lineId]/stats/route.ts` - Gets aggregate transaction stats for a line

**Files Modified:**
- `src/app/api/lines/[lineId]/remove-position/route.ts` - Added `action: "payout" | "refund"` parameter
- `src/components/QueueDisplay.tsx` - Added removal modal with transaction info and payout/refund buttons
- `src/app/dashboard/DashboardClient.tsx` - Added Stats button and modal for line owners

**UI Features:**
- Removal modal shows: total paid, total received, net amount
- "Payout" button: keeps transactions final, removes person
- "Refund" button: refunds all purchases that person made
- Stats modal shows: completed, refunded, net revenue

---

### 4. Transaction Settlement System
Transactions only count in stats when both buyer AND seller have left the line.

**Files Created:**
- `src/lib/settle-transactions.ts` - Helper function to settle transactions when someone leaves

**Files Modified:**
- `prisma/schema.prisma` - Added `settledAt` field to Transaction
- `src/app/api/lines/[lineId]/stats/route.ts` - Only counts settled transactions; shows pending settlement separately
- `src/app/api/lines/[lineId]/leave/route.ts` - Calls settle when user leaves
- `src/app/api/lines/[lineId]/remove-front/route.ts` - Calls settle when front is removed
- `src/app/api/lines/[lineId]/remove-position/route.ts` - Calls settle in both payout/refund paths
- `src/app/dashboard/DashboardClient.tsx` - Shows pending settlement amount in yellow

**How it works:**
- Completed transactions start with `settledAt: null`
- When someone leaves, check all their transactions
- If the other party (buyer/seller) is also not in line, set `settledAt` to current time
- Stats only count transactions where `settledAt` is not null

---

## Schema Changes

```prisma
model LinePosition {
  // ... existing fields
  lockedUntil DateTime? // Position is locked for swap until this time
  lockedBy    String?   // Transaction ID that locked this position
}

model Transaction {
  // ... existing fields
  settledAt DateTime? // Set when both buyer and seller have left the line
}
```

---

## Pending Actions
- Run `npx prisma generate` (requires stopping dev server)
- Run `npx prisma db push`
- Restart dev server

---

## Transaction Status Flow
```
PENDING -> COMPLETED (successful payment)
        -> FAILED (owner cancelled, payment failed)
        -> REFUNDED (owner chose refund, or auto-refund on FAILED)

COMPLETED + settledAt = null -> Both parties still in line (pending settlement)
COMPLETED + settledAt set -> Both parties left (counts in stats)
```
