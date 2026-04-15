"use client"

import Link from "next/link"
import { useState, useEffect, useCallback } from "react"
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
  status: "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED"
  settledAt: string | null
  stripePaymentId: string | null
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
}

interface SettlementData {
  transactions: Transaction[]
  summary: Summary
}

interface SettlementClientProps {
  lineId: string
  lineName: string
}

export function SettlementClient({ lineId, lineName }: SettlementClientProps) {
  const { addToast } = useToast()
  const [data, setData] = useState<SettlementData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [bulkConfirm, setBulkConfirm] = useState<"capture-all" | "cancel-all-unfulfilled" | null>(null)

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
          return { ...t, status: "REFUNDED" as const, settledAt: new Date().toISOString() }
        }),
        summary: {
          ...prev.summary,
          pendingAmount: Math.max(
            0,
            prev.summary.pendingAmount -
              (prev.transactions.find((t) => t.id === transactionId)?.amount || 0)
          ),
          capturedAmount:
            action === "capture"
              ? prev.summary.capturedAmount +
                (prev.transactions.find((t) => t.id === transactionId)?.amount || 0)
              : prev.summary.capturedAmount,
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
        addToast(
          action === "capture-all"
            ? `Captured ${result.count} transaction(s)`
            : `Cancelled ${result.count} unfulfilled transaction(s)`,
          "success"
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
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
          Cancelled
        </span>
      )
    }
    if (txn.status === "FAILED") {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          Failed
        </span>
      )
    }
    if (txn.status === "PENDING") {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          Pending
        </span>
      )
    }
    // COMPLETED
    if (txn.settledAt) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
          Captured
        </span>
      )
    }
    if (txn.buyerFulfilled) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
          Fulfilled
        </span>
      )
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        Not fulfilled
      </span>
    )
  }

  function getActionButtons(txn: Transaction) {
    // Only show actions for COMPLETED, unsettled transactions
    if (txn.status !== "COMPLETED" || txn.settledAt) return null

    const isLoading = actionLoading === txn.id

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
          <div className="h-8 w-64 bg-gray-200 rounded" />
          <div className="h-24 bg-gray-200 rounded-xl" />
          <div className="h-64 bg-gray-200 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 text-center">
        <p className="text-gray-500">Failed to load settlement data.</p>
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
            href="/dashboard"
            className="text-sm text-blue-600 hover:underline mb-1 inline-block"
          >
            &larr; Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            Settlement &mdash; {lineName}
          </h1>
        </div>
      </div>

      {/* Summary Stats */}
      <Card className="mb-6">
        <CardContent className="py-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">{summary.total}</p>
              <p className="text-sm text-gray-500">Transactions</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(summary.totalAmount)}
              </p>
              <p className="text-sm text-gray-500">Total Amount</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{summary.fulfilled}</p>
              <p className="text-sm text-gray-500">Fulfilled</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">{summary.unfulfilled}</p>
              <p className="text-sm text-gray-500">Unfulfilled</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4">
            <div className="text-center">
              <p className="text-lg font-semibold text-green-600">
                {formatCurrency(summary.capturedAmount)}
              </p>
              <p className="text-xs text-gray-500">Captured</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-amber-600">
                {formatCurrency(summary.pendingAmount)}
              </p>
              <p className="text-xs text-gray-500">Pending Decision</p>
            </div>
          </div>
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
          <h2 className="text-lg font-semibold text-gray-900">
            All Swap Transactions
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          {transactions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No swap transactions for this line.</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="px-6 py-3 font-medium">Buyer</th>
                      <th className="px-6 py-3 font-medium">Seller</th>
                      <th className="px-6 py-3 font-medium text-right">Amount</th>
                      <th className="px-6 py-3 font-medium text-center">Position</th>
                      <th className="px-6 py-3 font-medium text-center">Status</th>
                      <th className="px-6 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {transactions.map((txn) => (
                      <tr
                        key={txn.id}
                        className={`hover:bg-gray-50 transition-colors ${
                          txn.status === "REFUNDED"
                            ? "bg-red-50/30"
                            : txn.settledAt
                            ? "bg-green-50/30"
                            : ""
                        }`}
                      >
                        <td className="px-6 py-4">
                          <span className="font-medium text-gray-900">
                            {txn.buyerName}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          {txn.sellerName}
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-gray-900">
                          {formatCurrency(txn.amount)}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {txn.buyerPosition !== null ? (
                            <span className="text-blue-600 font-medium">
                              #{txn.buyerPosition}
                            </span>
                          ) : (
                            <span className="text-gray-400">Left</span>
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
              <div className="md:hidden divide-y divide-gray-100">
                {transactions.map((txn) => (
                  <div
                    key={txn.id}
                    className={`p-4 ${
                      txn.status === "REFUNDED"
                        ? "bg-red-50/30"
                        : txn.settledAt
                        ? "bg-green-50/30"
                        : ""
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-gray-900">
                          {txn.buyerName}
                          <span className="text-gray-400 mx-1">&larr;</span>
                          <span className="text-gray-600">{txn.sellerName}</span>
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {txn.buyerPosition !== null
                            ? `Position #${txn.buyerPosition}`
                            : "Left line"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-900">
                          {formatCurrency(txn.amount)}
                        </p>
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
