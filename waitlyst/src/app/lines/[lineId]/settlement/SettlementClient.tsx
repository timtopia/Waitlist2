"use client"

import Link from "next/link"
import { useState, useEffect, useCallback } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { ConfirmModal } from "@/components/ui/ConfirmModal"
import { useToast } from "@/components/ui/Toast"
import { formatCurrency } from "@/lib/format"

interface Transaction {
  id: string
  buyerId: string
  buyerName: string
  sellerId: string
  sellerName: string
  amount: number
  ownerFee: number
  status: "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED"
  settledAt: string | null
  sellerUnpaid?: boolean
  ownerFeeUnpaid?: boolean
  stripePaymentId: string | null
  /** The buyer's card hold lapses after this unless collected */
  captureBefore?: string | null
  holdExpired?: boolean
  buyerFulfilled: boolean
  buyerPosition: number | null
  createdAt: string
}

interface Summary {
  total: number
  fulfilled: number
  unfulfilled: number
  totalAmount: number
  capturedAmount: number
  pendingAmount: number
  stuckCount: number
  stuckAmount: number
  expiringCount?: number
  expiredCount?: number
  expiredAmount?: number
  ownerFeeCaptured: number
  ownerFeePending: number
  /** Collected from buyers but not yet sent to the owner's payout account */
  ownerFeeAwaitingPayout?: number
}

interface SettlementData {
  transactions: Transaction[]
  summary: Summary
}

function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

interface SettlementClientProps {
  lineId: string
  lineName: string
  stripeConnectOnboarded: boolean
  stripeEnabled: boolean
  kind: "STANDARD" | "RESTAURANT"
}

export function SettlementClient({ lineId, lineName, stripeConnectOnboarded, stripeEnabled, kind }: SettlementClientProps) {
  const { addToast } = useToast()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [data, setData] = useState<SettlementData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [bulkConfirm, setBulkConfirm] = useState<"capture-all" | "cancel-all-unfulfilled" | null>(null)
  const [connectOnboarded, setConnectOnboarded] = useState(stripeConnectOnboarded)
  const [connectLoading, setConnectLoading] = useState(false)

  useEffect(() => {
    const connectStatus = searchParams.get("connect")
    if (connectStatus === "success") {
      setConnectOnboarded(true)
      addToast("Payout account connected -- fees from this line will now be paid out.", "success")
      router.replace(pathname, { scroll: false })
    } else if (connectStatus === "incomplete") {
      addToast("Payout setup isn't finished yet. Pick it back up whenever you're ready.", "info")
      router.replace(pathname, { scroll: false })
    } else if (connectStatus === "error") {
      addToast("Something went wrong connecting your payout account. Please try again.", "error")
      router.replace(pathname, { scroll: false })
    }
  }, [searchParams, router, pathname, addToast])

  async function handleConnectSetup() {
    setConnectLoading(true)
    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: pathname }),
      })
      const result = await res.json()
      if (res.ok && result.url) {
        window.location.href = result.url
      } else {
        addToast(result.error || "Failed to start payout setup", "error")
        setConnectLoading(false)
      }
    } catch {
      addToast("Failed to start payout setup", "error")
      setConnectLoading(false)
    }
  }

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/lines/${lineId}/settlement`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      } else {
        addToast("Failed to load settlement data", "error")
      }
    } catch {
      addToast("Failed to load settlement data", "error")
    } finally {
      setLoading(false)
    }
  }, [lineId, addToast])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function handleAction(
    action: "capture" | "cancel",
    transactionId: string
  ) {
    setActionLoading(transactionId)

    const target = data?.transactions.find((t) => t.id === transactionId)
    const wasStuck = target?.status === "PENDING"

    // Optimistic update
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        transactions: prev.transactions.map((t) => {
          if (t.id !== transactionId) return t
          if (action === "capture") {
            return { ...t, settledAt: new Date().toISOString() }
          }
          // A stuck/unpaid checkout never had a hold, so cancelling it fails
          // it out rather than "refunding" money that was never charged.
          return {
            ...t,
            status: wasStuck ? ("FAILED" as const) : ("REFUNDED" as const),
            settledAt: new Date().toISOString(),
          }
        }),
        summary: wasStuck
          ? {
              ...prev.summary,
              stuckCount: Math.max(0, prev.summary.stuckCount - 1),
              stuckAmount: Math.max(0, prev.summary.stuckAmount - (target?.amount || 0)),
            }
          : {
              ...prev.summary,
              pendingAmount: Math.max(0, prev.summary.pendingAmount - (target?.amount || 0)),
              capturedAmount:
                action === "capture"
                  ? prev.summary.capturedAmount + (target?.amount || 0)
                  : prev.summary.capturedAmount,
              ownerFeePending: Math.max(0, prev.summary.ownerFeePending - (target?.ownerFee || 0)),
              ownerFeeCaptured:
                action === "capture"
                  ? prev.summary.ownerFeeCaptured + (target?.ownerFee || 0)
                  : prev.summary.ownerFeeCaptured,
            },
      }
    })

    try {
      const res = await fetch(`/api/lines/${lineId}/settlement/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId, action }),
      })

      if (res.ok) {
        addToast(
          action === "capture"
            ? "Payment captured successfully"
            : wasStuck
            ? "Stuck checkout cancelled -- positions unlocked"
            : "Authorization cancelled, hold released",
          "success"
        )
      } else {
        const err = await res.json()
        addToast(err.error || "Action failed", "error")
        // Revert optimistic update
        await fetchData()
      }
    } catch {
      addToast("Action failed", "error")
      await fetchData()
    } finally {
      setActionLoading(null)
    }
  }

  async function handleBulkAction(action: "capture-all" | "cancel-all-unfulfilled") {
    setBulkConfirm(null)
    setActionLoading(action)

    // Optimistic update
    setData((prev) => {
      if (!prev) return prev
      if (action === "capture-all") {
        return {
          ...prev,
          transactions: prev.transactions.map((t) => {
            if (t.status === "COMPLETED" && !t.settledAt) {
              return { ...t, settledAt: new Date().toISOString() }
            }
            return t
          }),
          summary: {
            ...prev.summary,
            capturedAmount: prev.summary.capturedAmount + prev.summary.pendingAmount,
            pendingAmount: 0,
          },
        }
      }
      // cancel-all-unfulfilled
      return {
        ...prev,
        transactions: prev.transactions.map((t) => {
          if (t.status === "COMPLETED" && !t.settledAt && !t.buyerFulfilled) {
            return { ...t, status: "REFUNDED" as const, settledAt: new Date().toISOString() }
          }
          return t
        }),
        summary: {
          ...prev.summary,
          unfulfilled: 0,
          pendingAmount: prev.summary.pendingAmount -
            prev.transactions
              .filter((t) => t.status === "COMPLETED" && !t.settledAt && !t.buyerFulfilled)
              .reduce((sum, t) => sum + t.amount, 0),
        },
      }
    })

    try {
      const res = await fetch(`/api/lines/${lineId}/settlement/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })

      if (res.ok) {
        const result = await res.json()
        const failed = result.failedCount > 0
          ? ` ${result.failedCount} couldn't be ${action === "capture-all" ? "collected" : "returned"} and are still listed.`
          : ""
        addToast(
          (action === "capture-all"
            ? `Captured ${result.count} transaction(s).`
            : `Returned ${result.count} payment(s) to buyers.`) + failed,
          result.failedCount > 0 ? "info" : "success"
        )
        // Refresh to get accurate server state
        await fetchData()
      } else {
        const err = await res.json()
        addToast(err.error || "Bulk action failed", "error")
        await fetchData()
      }
    } catch {
      addToast("Bulk action failed", "error")
      await fetchData()
    } finally {
      setActionLoading(null)
    }
  }

  function getStatusBadge(txn: Transaction) {
    if (txn.status === "REFUNDED") {
      return (
        <span className="inline-flex items-center font-mono text-xs uppercase tracking-widest text-accent">
          Cancelled
        </span>
      )
    }
    if (txn.holdExpired) {
      return (
        <span className="inline-flex flex-col items-center">
          <span className="font-mono text-xs uppercase tracking-widest text-accent">Hold expired</span>
          <span className="text-xs text-ink/50 mt-0.5">Not collected in time</span>
        </span>
      )
    }
    if (txn.status === "FAILED") {
      return (
        <span className="inline-flex items-center font-mono text-xs uppercase tracking-widest text-ink/50">
          Failed
        </span>
      )
    }
    if (txn.status === "PENDING") {
      return (
        <span className="inline-flex items-center font-mono text-xs uppercase tracking-widest text-accent">
          Awaiting payment
        </span>
      )
    }
    // COMPLETED
    if (txn.settledAt) {
      const waitingOn = [
        txn.sellerUnpaid && `${txn.sellerName}'s payout`,
        txn.ownerFeeUnpaid && "your fee",
      ].filter(Boolean)
      return (
        <span className="inline-flex flex-col items-center">
          <span className="font-mono text-xs uppercase tracking-widest text-green-700">Captured</span>
          {waitingOn.length > 0 && (
            <span className="text-xs text-ink/50 mt-0.5" title="Sent automatically once they set up payouts">
              Holding {waitingOn.join(" and ")} until payout setup
            </span>
          )}
        </span>
      )
    }
    const deadline = txn.captureBefore && (
      <span className="text-xs text-amber-600 mt-0.5" title="The buyer's card hold lapses after this and the payment can no longer be collected">
        Collect by {formatDeadline(txn.captureBefore)}
      </span>
    )
    if (txn.buyerFulfilled) {
      return (
        <span className="inline-flex flex-col items-center">
          <span className="font-mono text-xs uppercase tracking-widest text-green-700">Fulfilled</span>
          {deadline}
        </span>
      )
    }
    return (
      <span className="inline-flex flex-col items-center">
        <span className="font-mono text-xs uppercase tracking-widest text-amber-600">Not fulfilled</span>
        {deadline}
      </span>
    )
  }

  function getActionButtons(txn: Transaction) {
    const isLoading = actionLoading === txn.id

    // A PENDING transaction's checkout was never completed -- there's no
    // hold to capture or release, just a stuck/abandoned swap to clear out.
    if (txn.status === "PENDING") {
      return (
        <Button
          size="sm"
          variant="danger"
          onClick={() => handleAction("cancel", txn.id)}
          isLoading={isLoading}
        >
          Cancel Stuck Checkout
        </Button>
      )
    }

    // Only show capture/release actions for COMPLETED, unsettled transactions
    if (txn.status !== "COMPLETED" || txn.settledAt) return null

    if (txn.buyerFulfilled) {
      return (
        <Button
          size="sm"
          variant="primary"
          onClick={() => handleAction("capture", txn.id)}
          isLoading={isLoading}
        >
          Capture
        </Button>
      )
    }

    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() => handleAction("capture", txn.id)}
          isLoading={isLoading}
        >
          Capture (Honor)
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => handleAction("cancel", txn.id)}
          isLoading={isLoading}
        >
          Cancel (Release)
        </Button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-ink/10" />
          <div className="h-24 bg-ink/10" />
          <div className="h-64 bg-ink/10" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 text-center">
        <p className="text-ink/60">Failed to load settlement data.</p>
        <Link href="/dashboard">
          <Button variant="secondary" className="mt-4">
            Back to Dashboard
          </Button>
        </Link>
      </div>
    )
  }

  const { transactions, summary } = data
  const completedUnsettled = transactions.filter(
    (t) => t.status === "COMPLETED" && !t.settledAt
  )
  const hasPendingActions = completedUnsettled.length > 0
  const hasUnfulfilled = completedUnsettled.some((t) => !t.buyerFulfilled)

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Bulk Confirm Modal */}
      <ConfirmModal
        open={bulkConfirm === "capture-all"}
        title="Capture All Payments"
        message={`This will capture payment for all ${completedUnsettled.length} pending transaction(s), including unfulfilled buyers. Total: ${formatCurrency(summary.pendingAmount)}.`}
        confirmLabel="Capture All"
        variant="primary"
        isLoading={actionLoading === "capture-all"}
        onConfirm={() => handleBulkAction("capture-all")}
        onCancel={() => setBulkConfirm(null)}
      />
      <ConfirmModal
        open={bulkConfirm === "cancel-all-unfulfilled"}
        title="Cancel Unfulfilled Payments"
        message={`This will release the payment hold for all ${summary.unfulfilled} unfulfilled transaction(s). The buyers will not be charged.`}
        confirmLabel="Cancel All Unfulfilled"
        variant="danger"
        isLoading={actionLoading === "cancel-all-unfulfilled"}
        onConfirm={() => handleBulkAction("cancel-all-unfulfilled")}
        onCancel={() => setBulkConfirm(null)}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href={`/lines/${lineId}`}
            className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4 mb-2 inline-block"
          >
            &larr; Back to line
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            Settlement &mdash; {lineName}
          </h1>
          <p className="text-sm text-ink/60 mt-1 max-w-2xl">
            {kind === "RESTAURANT"
              ? "Paid swaps on this line are held on the buyer's card until you seat them. Seating a guest collects their payment automatically, and so does the guest leaving. Anything still held below you can capture, or release to give the buyer their money back. Settle holds the same evening, since card holds lapse after about a week."
              : "Paid swaps on this line are collected and paid out the moment they happen, so there's nothing to capture or release. Anything listed as pending below couldn't be collected automatically."}
          </p>
        </div>
      </div>

      {/* Payout Setup Prompt -- this is the moment an owner is looking at
          money they've earned, so it's the right place to ask them to
          connect a payout account if they haven't, rather than leaving that
          buried in Profile. */}
      {stripeEnabled && !connectOnboarded && (summary.ownerFeeCaptured > 0 || summary.ownerFeePending > 0) && (
        <Card className="mb-6 border-accent">
          <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-medium text-ink">
                You&apos;ve earned {formatCurrency(summary.ownerFeeCaptured + summary.ownerFeePending)} in fees from this line, but have no payout account connected.
              </p>
              <p className="text-sm text-ink/60 mt-0.5">
                Connect one now so this (and future) earnings actually reach you.
              </p>
            </div>
            <Button onClick={handleConnectSetup} isLoading={connectLoading} className="flex-shrink-0">
              Set Up Payouts
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <Card className="mb-6">
        <CardContent className="py-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="font-mono text-2xl tabular-nums">{summary.total}</p>
              <p className="font-mono text-xs uppercase tracking-widest text-ink/50">Transactions</p>
            </div>
            <div className="text-center">
              <p className="font-mono text-2xl tabular-nums">
                {formatCurrency(summary.totalAmount)}
              </p>
              <p className="font-mono text-xs uppercase tracking-widest text-ink/50">Total Amount</p>
            </div>
            <div className="text-center">
              <p className="font-mono text-2xl tabular-nums text-green-700">{summary.fulfilled}</p>
              <p className="font-mono text-xs uppercase tracking-widest text-ink/50">Fulfilled</p>
            </div>
            <div className="text-center">
              <p className="font-mono text-2xl tabular-nums text-amber-600">{summary.unfulfilled}</p>
              <p className="font-mono text-xs uppercase tracking-widest text-ink/50">Unfulfilled</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-rule grid grid-cols-2 gap-4">
            <div className="text-center">
              <p className="font-mono text-lg tabular-nums text-green-700">
                {formatCurrency(summary.capturedAmount)}
              </p>
              <p className="font-mono text-xs uppercase tracking-widest text-ink/50">Captured</p>
            </div>
            <div className="text-center">
              <p className="font-mono text-lg tabular-nums text-amber-600">
                {formatCurrency(summary.pendingAmount)}
              </p>
              <p className="font-mono text-xs uppercase tracking-widest text-ink/50">Pending Decision</p>
            </div>
          </div>
          {(summary.ownerFeeCaptured > 0 || summary.ownerFeePending > 0) && (
            <div className="mt-4 pt-4 border-t border-rule flex items-center justify-between">
              <div>
                <p className="font-mono text-sm text-ink/60 uppercase tracking-widest">Your fee earnings</p>
                <p className="text-xs text-ink/50 mt-0.5">What you actually receive, on top of what sellers get.</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg tabular-nums text-green-700">
                  {formatCurrency(summary.ownerFeeCaptured)}
                  {summary.ownerFeePending > 0 && (
                    <span className="text-amber-600"> + {formatCurrency(summary.ownerFeePending)} pending</span>
                  )}
                </p>
              </div>
            </div>
          )}
          {stripeEnabled && connectOnboarded && (summary.ownerFeeCaptured > 0 || summary.ownerFeePending > 0) && (
            <div className="mt-4 pt-4 border-t border-rule flex items-center justify-between">
              <p className="text-xs text-ink/50">
                {(summary.ownerFeeAwaitingPayout ?? 0) > 0
                  ? `Payouts are connected, but ${formatCurrency(summary.ownerFeeAwaitingPayout ?? 0)} of your collected fees hasn't reached your payout account yet.`
                  : "Payouts are connected -- collected fees go to your payout account automatically."}
              </p>
              <Link
                href="/profile"
                className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4 flex-shrink-0"
              >
                View Payout Dashboard &rarr;
              </Link>
            </div>
          )}
          {(summary.expiringCount ?? 0) > 0 && (
            <div className="mt-4 pt-4 border-t border-rule">
              <p className="font-mono text-sm tabular-nums text-amber-600">
                {summary.expiringCount} payment hold{summary.expiringCount === 1 ? "" : "s"} expire{summary.expiringCount === 1 ? "s" : ""} within 48 hours
              </p>
              <p className="text-xs text-ink/50 mt-0.5">
                Card holds only last about a week. Capture or release these before their deadline, or the money can&apos;t be collected.
              </p>
            </div>
          )}
          {(summary.expiredCount ?? 0) > 0 && (
            <div className="mt-4 pt-4 border-t border-rule">
              <p className="font-mono text-sm tabular-nums text-accent">
                {summary.expiredCount} hold{summary.expiredCount === 1 ? "" : "s"} expired before collection ({formatCurrency(summary.expiredAmount ?? 0)})
              </p>
              <p className="text-xs text-ink/50 mt-0.5">
                The buyer kept the spot but wasn&apos;t charged, and the seller won&apos;t be paid for it.
              </p>
            </div>
          )}
          {summary.stuckCount > 0 && (
            <div className="mt-4 pt-4 border-t border-rule flex items-center justify-between">
              <div>
                <p className="font-mono text-sm tabular-nums text-accent">
                  {summary.stuckCount} checkout{summary.stuckCount === 1 ? "" : "s"} never completed ({formatCurrency(summary.stuckAmount)})
                </p>
                <p className="text-xs text-ink/50 mt-0.5">
                  Someone started a swap but never paid, or the link broke. Cancel it below to free up the positions.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {hasPendingActions && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Button
            variant="primary"
            onClick={() => setBulkConfirm("capture-all")}
            disabled={actionLoading !== null}
          >
            Capture All ({completedUnsettled.length})
          </Button>
          {hasUnfulfilled && (
            <Button
              variant="danger"
              onClick={() => setBulkConfirm("cancel-all-unfulfilled")}
              disabled={actionLoading !== null}
            >
              Cancel All Unfulfilled ({summary.unfulfilled})
            </Button>
          )}
        </div>
      )}

      {/* Transactions List */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold tracking-tight">
            All Swap Transactions
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          {transactions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-ink/60">No swap transactions for this line.</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink text-left">
                      <th className="px-6 py-3 font-mono text-xs uppercase tracking-widest font-normal text-ink/50">Buyer</th>
                      <th className="px-6 py-3 font-mono text-xs uppercase tracking-widest font-normal text-ink/50">Seller</th>
                      <th className="px-6 py-3 font-mono text-xs uppercase tracking-widest font-normal text-ink/50 text-right">Amount</th>
                      <th className="px-6 py-3 font-mono text-xs uppercase tracking-widest font-normal text-ink/50 text-center">Position</th>
                      <th className="px-6 py-3 font-mono text-xs uppercase tracking-widest font-normal text-ink/50 text-center">Status</th>
                      <th className="px-6 py-3 font-mono text-xs uppercase tracking-widest font-normal text-ink/50 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {transactions.map((txn) => (
                      <tr
                        key={txn.id}
                        className={`hover:bg-paper transition-colors ${
                          txn.status === "REFUNDED"
                            ? "bg-accent/5"
                            : txn.settledAt
                            ? "bg-green-700/5"
                            : ""
                        }`}
                      >
                        <td className="px-6 py-4">
                          <span className="font-medium text-ink">
                            {txn.buyerName}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-ink/60">
                          {txn.sellerName}
                        </td>
                        <td className="px-6 py-4 text-right font-mono tabular-nums text-ink">
                          {formatCurrency(txn.amount)}
                          {txn.ownerFee > 0 && (
                            <span className="block text-xs text-ink/50">Your fee {formatCurrency(txn.ownerFee)}</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {txn.buyerPosition !== null ? (
                            <span className="font-mono tabular-nums text-accent">
                              #{txn.buyerPosition}
                            </span>
                          ) : txn.buyerFulfilled ? (
                            <span className="text-green-700">{kind === "RESTAURANT" ? "Seated" : "Served"}</span>
                          ) : (
                            <span className="text-ink/40">Left</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {getStatusBadge(txn)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {getActionButtons(txn)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-rule">
                {transactions.map((txn) => (
                  <div
                    key={txn.id}
                    className={`p-4 ${
                      txn.status === "REFUNDED"
                        ? "bg-accent/5"
                        : txn.settledAt
                        ? "bg-green-700/5"
                        : ""
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-ink">
                          {txn.buyerName}
                          <span className="text-ink/40 mx-1">&larr;</span>
                          <span className="text-ink/60">{txn.sellerName}</span>
                        </p>
                        <p className="font-mono text-xs tabular-nums text-ink/50 mt-0.5">
                          {txn.buyerPosition !== null
                            ? `Position #${txn.buyerPosition}`
                            : txn.buyerFulfilled
                              ? kind === "RESTAURANT" ? "Seated" : "Served"
                              : "Left line"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono tabular-nums font-medium text-ink">
                          {formatCurrency(txn.amount)}
                        </p>
                        {txn.ownerFee > 0 && (
                          <p className="font-mono text-xs tabular-nums text-ink/50">Your fee {formatCurrency(txn.ownerFee)}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      {getStatusBadge(txn)}
                      <div className="flex-shrink-0">{getActionButtons(txn)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
