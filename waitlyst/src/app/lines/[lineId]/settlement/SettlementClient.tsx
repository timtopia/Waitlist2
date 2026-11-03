"use client"

import Link from "next/link"
import { useState, useEffect, useCallback } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { buttonClasses } from "@/components/ui/buttonStyles"
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

/**
 * A hold the owner may release: the buyer left without being served. A buyer
 * still in line keeps the spot they bought, so releasing would make it free.
 */
function releasable(t: { buyerFulfilled: boolean; buyerPosition: number | null }) {
  return !t.buyerFulfilled && t.buyerPosition === null
}

export function SettlementClient({ lineId, lineName, stripeConnectOnboarded, stripeEnabled, kind }: SettlementClientProps) {
  const isDrop = kind !== "RESTAURANT"
  const { addToast } = useToast()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [data, setData] = useState<SettlementData | null>(null)
  const [loading, setLoading] = useState(true)
  // Why the last load failed: a deleted line shouldn't offer "Try again"
  const [loadStatus, setLoadStatus] = useState<number | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [bulkConfirm, setBulkConfirm] = useState<"capture-all" | "cancel-all-unfulfilled" | null>(null)
  // Releasing a hold or killing a checkout can't be undone, so ask first
  const [cancelConfirm, setCancelConfirm] = useState<Transaction | null>(null)
  const [connectOnboarded, setConnectOnboarded] = useState(stripeConnectOnboarded)
  const [connectLoading, setConnectLoading] = useState(false)
  const [dashboardLoading, setDashboardLoading] = useState(false)

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

  async function handleOpenPayoutDashboard() {
    setDashboardLoading(true)
    try {
      const res = await fetch("/api/stripe/connect/dashboard", { method: "POST" })
      const result = await res.json()
      if (res.ok && result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer")
      } else {
        addToast(result.error || "Couldn't open the payout dashboard", "error")
      }
    } catch {
      addToast("Couldn't open the payout dashboard", "error")
    } finally {
      setDashboardLoading(false)
    }
  }

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/lines/${lineId}/settlement`)
      const json = res.ok ? await res.json().catch(() => null) : null
      if (json) {
        setData(json)
        setLoadStatus(null)
      } else {
        setLoadStatus(res.status === 404 ? 404 : res.status || 500)
        addToast("Failed to load settlement data", "error")
      }
    } catch {
      setLoadStatus(0)
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
    // Restored if the request fails: a re-fetch can fail too when offline,
    // which used to leave "Captured" showing for money that wasn't
    const snapshot = data

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
            ? isDrop ? "Payment collected" : "Payment captured successfully"
            : wasStuck
            ? "Stuck checkout cancelled -- positions unlocked"
            : isDrop ? "Payment returned to the buyer" : "Authorization cancelled, hold released",
          "success"
        )
        // Payouts waiting on a seller's setup (and changes made from another
        // device) only show after a refetch; the optimistic row doesn't know
        await fetchData()
      } else {
        const err = await res.json().catch(() => ({}))
        addToast(err.error || "Action failed", "error")
        // Revert optimistic update
        setData(snapshot)
        await fetchData()
      }
    } catch {
      addToast("No connection -- nothing was changed. Try again.", "error")
      setData(snapshot)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleBulkAction(action: "capture-all" | "cancel-all-unfulfilled") {
    setBulkConfirm(null)
    setActionLoading(action)
    const snapshot = data

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
          if (t.status === "COMPLETED" && !t.settledAt && releasable(t)) {
            return { ...t, status: "REFUNDED" as const, settledAt: new Date().toISOString() }
          }
          return t
        }),
        summary: {
          ...prev.summary,
          unfulfilled: prev.transactions.filter(
            (t) => t.status === "COMPLETED" && !t.settledAt && !t.buyerFulfilled && !releasable(t)
          ).length,
          pendingAmount: prev.summary.pendingAmount -
            prev.transactions
              .filter((t) => t.status === "COMPLETED" && !t.settledAt && releasable(t))
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
            ? `${isDrop ? "Collected" : "Captured"} ${result.count} payment${result.count === 1 ? "" : "s"}.`
            : `Returned ${result.count} payment${result.count === 1 ? "" : "s"} to buyers.`) + failed,
          result.failedCount > 0 ? "info" : "success"
        )
        // Refresh to get accurate server state
        await fetchData()
      } else {
        const err = await res.json().catch(() => ({}))
        addToast(err.error || "Bulk action failed", "error")
        setData(snapshot)
        await fetchData()
      }
    } catch {
      addToast("No connection -- nothing was changed. Try again.", "error")
      setData(snapshot)
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
          <span className="text-xs text-ink/60 mt-0.5">Not collected in time</span>
        </span>
      )
    }
    if (txn.status === "FAILED") {
      return (
        <span className="inline-flex items-center font-mono text-xs uppercase tracking-widest text-ink/60">
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
          <span className="font-mono text-xs uppercase tracking-widest text-green-700">{isDrop ? "Collected" : "Captured"}</span>
          {waitingOn.length > 0 && (
            <span className="text-xs text-ink/60 mt-0.5" title="Sent automatically once they set up payouts">
              Holding {waitingOn.join(" and ")} until payout setup
            </span>
          )}
        </span>
      )
    }
    const deadline = txn.captureBefore && (
      <span className="text-xs text-amber-700 mt-0.5" title="The buyer's card hold lapses after this and the payment can no longer be collected">
        Collect by {formatDeadline(txn.captureBefore)}
      </span>
    )
    // On drops payments are collected straight away; an open one here is a
    // collection that failed, not a hold waiting on fulfilment
    if (isDrop) {
      return (
        <span className="inline-flex flex-col items-center">
          <span className="font-mono text-xs uppercase tracking-widest text-amber-700">Collection failed</span>
          {deadline}
        </span>
      )
    }
    if (txn.buyerFulfilled) {
      return (
        <span className="inline-flex flex-col items-center">
          <span className="font-mono text-xs uppercase tracking-widest text-green-700">Seated</span>
          {deadline}
        </span>
      )
    }
    return (
      <span className="inline-flex flex-col items-center">
        <span className="font-mono text-xs uppercase tracking-widest text-amber-700">Not seated</span>
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
          onClick={() => setCancelConfirm(txn)}
          isLoading={isLoading}
          aria-label={`Cancel ${txn.buyerName}'s stuck checkout`}
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
          aria-label={`${isDrop ? "Collect" : "Capture"} ${txn.buyerName}'s payment`}
        >
          {isDrop ? "Collect" : "Capture"}
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
          aria-label={`${isDrop ? "Collect" : "Capture"} ${txn.buyerName}'s payment`}
        >
          {isDrop ? "Collect" : "Capture (Honor)"}
        </Button>
        {releasable(txn) && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCancelConfirm(txn)}
            isLoading={isLoading}
            aria-label={`Release ${txn.buyerName}'s ${isDrop ? "payment" : "card hold"}`}
          >
            {isDrop ? "Release" : "Cancel (Release)"}
          </Button>
        )}
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
        <p className="text-ink/60" role="alert">
          {loadStatus === 404
            ? "This line was deleted."
            : loadStatus === 0
              ? "No connection. Couldn't load settlement data."
              : "Couldn't load settlement data."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {loadStatus !== 404 && (
            <Button onClick={() => { setLoading(true); fetchData() }}>Try again</Button>
          )}
          <Link href="/dashboard" className={buttonClasses({ variant: "secondary" })}>Back to Dashboard</Link>
        </div>
      </div>
    )
  }

  const { transactions, summary } = data
  const completedUnsettled = transactions.filter(
    (t) => t.status === "COMPLETED" && !t.settledAt
  )
  const hasPendingActions = completedUnsettled.length > 0
  const releasableCount = completedUnsettled.filter(releasable).length
  const hasUnfulfilled = releasableCount > 0

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Bulk Confirm Modal */}
      <ConfirmModal
        open={bulkConfirm === "capture-all"}
        title={isDrop ? "Retry Collecting Payments" : "Capture All Payments"}
        message={isDrop
          ? `Try again to collect the ${completedUnsettled.length} swap payment(s) that couldn't be collected automatically. Total: ${formatCurrency(summary.pendingAmount)}.`
          : `This will collect all ${completedUnsettled.length} payment(s) still on hold, including buyers you haven't seated yet. Total: ${formatCurrency(summary.pendingAmount)}.`}
        confirmLabel={isDrop ? "Collect All" : "Capture All"}
        variant="primary"
        isLoading={actionLoading === "capture-all"}
        onConfirm={() => handleBulkAction("capture-all")}
        onCancel={() => setBulkConfirm(null)}
      />
      <ConfirmModal
        open={cancelConfirm !== null}
        title={cancelConfirm?.status === "PENDING" ? "Cancel Checkout" : isDrop ? "Cancel This Payment" : "Release Payment Hold"}
        message={
          cancelConfirm?.status === "PENDING"
            ? `Cancel ${cancelConfirm.buyerName}'s unfinished checkout for ${formatCurrency(cancelConfirm.amount)} (started ${formatDeadline(cancelConfirm.createdAt)})? If they're still on the payment page, their payment will fail and both spots unlock.`
            : cancelConfirm
              ? `${isDrop ? `Cancel ${cancelConfirm.buyerName}'s uncollected payment of` : `Release the hold on ${cancelConfirm.buyerName}'s card for`} ${formatCurrency(cancelConfirm.amount)}? They won't be charged, ${cancelConfirm.sellerName} won't be paid for the spot${cancelConfirm.ownerFee > 0 ? `, and you give up your ${formatCurrency(cancelConfirm.ownerFee)} fee` : ""}. This can't be undone.`
              : ""
        }
        confirmLabel={cancelConfirm?.status === "PENDING" ? "Cancel Checkout" : isDrop ? "Cancel Payment" : "Release Hold"}
        variant="danger"
        onConfirm={() => {
          const target = cancelConfirm
          setCancelConfirm(null)
          if (target) handleAction("cancel", target.id)
        }}
        onCancel={() => setCancelConfirm(null)}
      />
      <ConfirmModal
        open={bulkConfirm === "cancel-all-unfulfilled"}
        title="Release Holds for Buyers Not Served"
        message={`This will release the payment hold for ${releasableCount} transaction(s) awaiting capture whose buyer left without being served. They will not be charged. Buyers still in line aren't affected.`}
        confirmLabel="Release All Not Served"
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
          <a
            href={`/api/lines/${lineId}/export?type=swaps`}
            className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4 mt-1 inline-block"
          >
            Export swaps CSV
          </a>
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
                You&apos;ve earned {formatCurrency(summary.ownerFeeCaptured)} in fees from this line{summary.ownerFeePending > 0 && ` (plus ${formatCurrency(summary.ownerFeePending)} ${isDrop ? "not yet collected" : "still on hold"})`}, but have no payout account connected.
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
              <p className="font-mono text-xs uppercase tracking-widest text-ink/60">Transactions</p>
            </div>
            <div className="text-center">
              <p className="font-mono text-2xl tabular-nums">
                {formatCurrency(summary.totalAmount)}
              </p>
              <p className="font-mono text-xs uppercase tracking-widest text-ink/60" title="Asking price of every paid swap, including any not yet collected or still waiting on the seller's payout setup. Excludes your fee.">Swap sales</p>
            </div>
            {isDrop ? (
              // Drop swaps are collected as they happen, so "awaiting capture"
              // is nearly always 0/0 here. Say what the owner wants to know:
              // how many went through, and how many need a look.
              <>
                <div className="text-center">
                  <p className="font-mono text-2xl tabular-nums text-green-700">{summary.total - completedUnsettled.length}</p>
                  <p className="font-mono text-xs uppercase tracking-widest text-ink/60">Collected</p>
                </div>
                <div className="text-center">
                  <p className={`font-mono text-2xl tabular-nums ${completedUnsettled.length > 0 ? "text-amber-700" : "text-ink/60"}`}>{completedUnsettled.length}</p>
                  <p className="font-mono text-xs uppercase tracking-widest text-ink/60">Need attention</p>
                </div>
              </>
            ) : (
              <>
                <div className="text-center">
                  <p className="font-mono text-2xl tabular-nums text-green-700">{summary.fulfilled}</p>
                  <p className="font-mono text-xs uppercase tracking-widest text-ink/60">Awaiting capture: served</p>
                </div>
                <div className="text-center">
                  <p className="font-mono text-2xl tabular-nums text-amber-700">{summary.unfulfilled}</p>
                  <p className="font-mono text-xs uppercase tracking-widest text-ink/60">Awaiting capture: not served</p>
                </div>
              </>
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-rule grid grid-cols-2 gap-4">
            <div className="text-center">
              <p className="font-mono text-lg tabular-nums text-green-700">
                {formatCurrency(summary.capturedAmount)}
              </p>
              <p className="font-mono text-xs uppercase tracking-widest text-ink/60">{isDrop ? "Collected" : "Captured"}</p>
            </div>
            <div className="text-center">
              <p className="font-mono text-lg tabular-nums text-amber-700">
                {formatCurrency(summary.pendingAmount)}
              </p>
              <p className="font-mono text-xs uppercase tracking-widest text-ink/60">{isDrop ? "Not collected" : "Pending Decision"}</p>
            </div>
          </div>
          {(summary.ownerFeeCaptured > 0 || summary.ownerFeePending > 0) && (
            <div className="mt-4 pt-4 border-t border-rule flex items-center justify-between">
              <div>
                <p className="font-mono text-sm text-ink/60 uppercase tracking-widest">Your fee earnings</p>
                <p className="text-xs text-ink/60 mt-0.5">What you actually receive, on top of what sellers get.</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg tabular-nums text-green-700">
                  {formatCurrency(summary.ownerFeeCaptured)}
                  {summary.ownerFeePending > 0 && (
                    <span className="text-amber-700"> + {formatCurrency(summary.ownerFeePending)} pending</span>
                  )}
                </p>
              </div>
            </div>
          )}
          {stripeEnabled && connectOnboarded && (summary.ownerFeeCaptured > 0 || summary.ownerFeePending > 0) && (
            <div className="mt-4 pt-4 border-t border-rule flex items-center justify-between">
              <p className="text-xs text-ink/60">
                {(summary.ownerFeeAwaitingPayout ?? 0) > 0
                  ? `Payouts are connected, but ${formatCurrency(summary.ownerFeeAwaitingPayout ?? 0)} of your collected fees hasn't reached your payout account yet.`
                  : "Payouts are connected -- collected fees go to your payout account automatically."}
              </p>
              <button
                type="button"
                onClick={handleOpenPayoutDashboard}
                disabled={dashboardLoading}
                className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4 flex-shrink-0 disabled:opacity-50"
              >
                {dashboardLoading ? "Opening..." : <>View Payout Dashboard &rarr;</>}
              </button>
            </div>
          )}
          {(summary.expiringCount ?? 0) > 0 && (
            <div className="mt-4 pt-4 border-t border-rule">
              <p className="font-mono text-sm tabular-nums text-amber-700">
                {summary.expiringCount} payment hold{summary.expiringCount === 1 ? "" : "s"} expire{summary.expiringCount === 1 ? "s" : ""} within 48 hours
              </p>
              <p className="text-xs text-ink/60 mt-0.5">
                Card holds only last about a week. Capture or release these before their deadline, or the money can&apos;t be collected.
              </p>
            </div>
          )}
          {(summary.expiredCount ?? 0) > 0 && (
            <div className="mt-4 pt-4 border-t border-rule">
              <p className="font-mono text-sm tabular-nums text-accent">
                {summary.expiredCount} hold{summary.expiredCount === 1 ? "" : "s"} expired before collection ({formatCurrency(summary.expiredAmount ?? 0)})
              </p>
              <p className="text-xs text-ink/60 mt-0.5">
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
                <p className="text-xs text-ink/60 mt-0.5">
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
            {isDrop ? "Collect All" : "Capture All"} ({completedUnsettled.length})
          </Button>
          {hasUnfulfilled && (
            <Button
              variant="danger"
              onClick={() => setBulkConfirm("cancel-all-unfulfilled")}
              disabled={actionLoading !== null}
            >
              Release All Not Served ({releasableCount})
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
                      <th className="px-6 py-3 font-mono text-xs uppercase tracking-widest font-normal text-ink/60">Buyer</th>
                      <th className="px-6 py-3 font-mono text-xs uppercase tracking-widest font-normal text-ink/60">Seller</th>
                      <th className="px-6 py-3 font-mono text-xs uppercase tracking-widest font-normal text-ink/60 text-right">Amount</th>
                      <th className="px-6 py-3 font-mono text-xs uppercase tracking-widest font-normal text-ink/60 text-center">Position</th>
                      <th className="px-6 py-3 font-mono text-xs uppercase tracking-widest font-normal text-ink/60 text-center">Status</th>
                      <th className="px-6 py-3 font-mono text-xs uppercase tracking-widest font-normal text-ink/60 text-right">Actions</th>
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
                            <span className="block text-xs text-ink/60">Your fee {formatCurrency(txn.ownerFee)}</span>
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
                            <span className="text-ink/60">Left</span>
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
                          <span className="text-ink/60 mx-1">&larr;</span>
                          <span className="text-ink/60">{txn.sellerName}</span>
                        </p>
                        <p className="font-mono text-xs tabular-nums text-ink/60 mt-0.5">
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
                          <p className="font-mono text-xs tabular-nums text-ink/60">Your fee {formatCurrency(txn.ownerFee)}</p>
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
