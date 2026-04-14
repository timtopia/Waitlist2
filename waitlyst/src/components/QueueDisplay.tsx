"use client"

import Image from "next/image"
import { Button } from "./ui/Button"
import { ConfirmModal } from "./ui/ConfirmModal"
import { useToast } from "./ui/Toast"
import { useState, useEffect, useCallback } from "react"
import { useSession } from "next-auth/react"
import { calcFees } from "@/lib/fees"
import { formatCurrency } from "@/lib/format"

interface Position {
  id: string
  position: number
  askingPrice: number | null
  lockedUntil: string | null
  user: {
    id: string
    name: string | null
    image: string | null
  }
}

interface TransactionInfo {
  totalPaid: number
  totalReceived: number
  netAmount: number
  totalRefundedToBuyer: number
  totalRefundedAsSeller: number
  asBuyer: { id: string; amount: number; status: string }[]
  asSeller: { id: string; amount: number; status: string }[]
}

interface RemovalModal {
  positionId: string
  userId: string
  userName: string | null
  transactionInfo: TransactionInfo | null
  loading: boolean
}

interface FeeInfo {
  ownerFeePercent: number
  platformFeePercent: number
}

interface QueueDisplayProps {
  lineId: string
  positions: Position[]
  onRefresh: () => void
  isCreator?: boolean
  feeInfo?: FeeInfo
  isPaused?: boolean
}

/** Format estimated wait time into a human-readable string */
function formatWaitTime(minutes: number): string {
  if (minutes < 1) return "<1 min"
  if (minutes < 60) return `~${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 2) return "~1 hr"
  return `~${Math.round(hours)} hrs`
}

export function QueueDisplay({ lineId, positions, onRefresh, isCreator = false, feeInfo, isPaused = false }: QueueDisplayProps) {
  const { data: session } = useSession()
  const { addToast } = useToast()
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [priceInput, setPriceInput] = useState<{ [key: string]: string }>({})
  const [editingPrice, setEditingPrice] = useState<string | null>(null)
  const [removalModal, setRemovalModal] = useState<RemovalModal | null>(null)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [showBuyConfirm, setShowBuyConfirm] = useState(false)
  const [waitTimeData, setWaitTimeData] = useState<{ estimatedMinutesPerPerson: number | null; basedOn: number } | null>(null)

  // Batch select state
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBatchConfirm, setShowBatchConfirm] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)

  const fetchWaitTime = useCallback(async () => {
    try {
      const res = await fetch(`/api/lines/${lineId}/wait-time`)
      if (res.ok) {
        const data = await res.json()
        setWaitTimeData(data)
      }
    } catch {
      // Silently fail — wait time is non-critical
    }
  }, [lineId])

  useEffect(() => {
    fetchWaitTime()
  }, [fetchWaitTime, positions.length])

  const currentUserPosition = positions.find((p) => p.user.id === session?.user?.id)
  const positionInFront = currentUserPosition
    ? positions.find((p) => p.position === currentUserPosition.position - 1)
    : null

  async function handleSetPrice(positionId: string) {
    const price = priceInput[positionId]
    if (!price && price !== "") return

    setLoadingAction(`price-${positionId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/price`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: price === "" ? null : parseFloat(price) }),
      })
      if (res.ok) {
        onRefresh()
        setEditingPrice(null)
      }
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleBuy() {
    setShowBuyConfirm(false)
    setLoadingAction("buy")
    try {
      const res = await fetch(`/api/lines/${lineId}/checkout`, {
        method: "POST",
      })
      const data = await res.json()
      if (res.ok) {
        if (data.url) {
          window.location.href = data.url
        } else if (data.devMode) {
          addToast("Position purchased! You moved up.", "success")
          onRefresh()
        }
      } else {
        addToast(data.error || "Failed to start checkout", "error")
      }
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleLeave() {
    setShowLeaveConfirm(false)
    setLoadingAction("leave")
    try {
      const res = await fetch(`/api/lines/${lineId}/leave`, {
        method: "DELETE",
      })
      if (res.ok) {
        addToast("You left the line", "info")
        onRefresh()
      }
    } finally {
      setLoadingAction(null)
    }
  }

  async function openRemovalModal(positionId: string, userId: string, userName: string | null) {
    setRemovalModal({
      positionId,
      userId,
      userName,
      transactionInfo: null,
      loading: true,
    })

    try {
      const res = await fetch(`/api/lines/${lineId}/position-transactions?userId=${userId}`)
      if (res.ok) {
        const data = await res.json()
        setRemovalModal(prev => prev ? { ...prev, transactionInfo: data, loading: false } : null)
      } else {
        setRemovalModal(prev => prev ? { ...prev, loading: false } : null)
      }
    } catch {
      setRemovalModal(prev => prev ? { ...prev, loading: false } : null)
    }
  }

  async function handleRemoveWithAction(action: "payout" | "refund") {
    if (!removalModal) return

    setLoadingAction(`remove-${removalModal.positionId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/remove-position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionId: removalModal.positionId,
          action,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (action === "refund" && data.refundedCount > 0) {
          addToast(`Refunded ${data.refundedCount} transaction(s) totaling ${formatCurrency(data.refundedAmount)}`, "success")
        } else {
          addToast("Person removed from line", "success")
        }
        setRemovalModal(null)
        onRefresh()
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to remove person", "error")
      }
    } finally {
      setLoadingAction(null)
    }
  }

  function toggleSelection(positionId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(positionId)) {
        next.delete(positionId)
      } else {
        next.add(positionId)
      }
      return next
    })
  }

  function cancelSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  async function handleBatchRemove(action: "payout" | "refund") {
    setShowBatchConfirm(false)
    setBatchLoading(true)
    try {
      const res = await fetch(`/api/lines/${lineId}/batch-remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionIds: Array.from(selectedIds),
          action,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const msg = data.failed > 0
          ? `Removed ${data.removed}, ${data.failed} failed`
          : `Removed ${data.removed} ${data.removed === 1 ? "person" : "people"} from line`
        addToast(msg, data.failed > 0 ? "info" : "success")
        cancelSelectMode()
        onRefresh()
      } else {
        const data = await res.json()
        addToast(data.error || "Batch remove failed", "error")
      }
    } finally {
      setBatchLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Removal Modal */}
      {removalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Remove {removalModal.userName || "this person"}?
            </h3>

            {removalModal.loading ? (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-sm text-gray-500 mt-2">Loading transaction history...</p>
              </div>
            ) : removalModal.transactionInfo ? (
              <div className="space-y-3 mb-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Paid:</span> {formatCurrency(removalModal.transactionInfo.totalPaid)}
                    <span className="text-gray-400 ml-1">({removalModal.transactionInfo.asBuyer.length} purchases)</span>
                  </p>
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Received:</span> {formatCurrency(removalModal.transactionInfo.totalReceived)}
                    <span className="text-gray-400 ml-1">({removalModal.transactionInfo.asSeller.filter(t => t.status === "COMPLETED").length} sales)</span>
                  </p>
                  {(removalModal.transactionInfo.totalRefundedToBuyer > 0 || removalModal.transactionInfo.totalRefundedAsSeller > 0) && (
                    <p className="text-sm text-amber-600">
                      <span className="font-medium">Already Refunded:</span> {formatCurrency(removalModal.transactionInfo.totalRefundedToBuyer + removalModal.transactionInfo.totalRefundedAsSeller)}
                    </p>
                  )}
                  <p className="text-sm font-medium text-gray-900 mt-1 pt-1 border-t">
                    Net: {formatCurrency(removalModal.transactionInfo.netAmount)}
                  </p>
                </div>

                <p className="text-sm text-gray-600">
                  Choose how to handle their transactions:
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-600 mb-4">No transaction history found.</p>
            )}

            <div className="flex flex-col space-y-2">
              <Button
                onClick={() => handleRemoveWithAction("payout")}
                isLoading={loadingAction === `remove-${removalModal.positionId}`}
                className="w-full"
              >
                Payout (Keep Transactions Final)
              </Button>
              {removalModal.transactionInfo && removalModal.transactionInfo.asBuyer.filter(t => t.status === "COMPLETED").length > 0 && (
                <Button
                  variant="danger"
                  onClick={() => handleRemoveWithAction("refund")}
                  isLoading={loadingAction === `remove-${removalModal.positionId}`}
                  className="w-full"
                >
                  Refund ({formatCurrency(removalModal.transactionInfo.totalPaid)} to buyer)
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => setRemovalModal(null)}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Confirmation */}
      <ConfirmModal
        open={showLeaveConfirm}
        title="Leave Line"
        message="Are you sure you want to leave this line? You'll lose your position and any unsettled transactions."
        confirmLabel="Leave Line"
        variant="danger"
        isLoading={loadingAction === "leave"}
        onConfirm={handleLeave}
        onCancel={() => setShowLeaveConfirm(false)}
      />

      {/* Buy Confirmation */}
      {(() => {
        const buyFees = positionInFront?.askingPrice && feeInfo ? calcFees(positionInFront.askingPrice, feeInfo.ownerFeePercent, feeInfo.platformFeePercent) : null
        const hasFees = buyFees && (buyFees.ownerFee > 0 || buyFees.platformFee > 0)
        return (
          <ConfirmModal
            open={showBuyConfirm}
            title="Buy Position"
            message={positionInFront?.askingPrice
              ? hasFees
                ? `Position price: ${formatCurrency(positionInFront.askingPrice)}\nFees: ${formatCurrency(buyFees!.ownerFee + buyFees!.platformFee)}\nTotal: ${formatCurrency(buyFees!.total)}\n\nYou'll swap places with the person in front.`
                : `Buy the position ahead of you for ${formatCurrency(positionInFront.askingPrice)}? You'll swap places with the person in front.`
              : "Buy the position ahead of you?"}
            confirmLabel={buyFees ? `Pay ${formatCurrency(buyFees.total)}` : "Buy"}
            variant="primary"
            isLoading={loadingAction === "buy"}
            onConfirm={handleBuy}
            onCancel={() => setShowBuyConfirm(false)}
          />
        )
      })()}

      {/* Batch Remove Confirm Modal */}
      {showBatchConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Remove {selectedIds.size} {selectedIds.size === 1 ? "person" : "people"}?
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Choose how to handle their transactions:
            </p>
            <div className="flex flex-col space-y-2">
              <Button
                onClick={() => handleBatchRemove("payout")}
                isLoading={batchLoading}
                className="w-full"
              >
                Payout (Keep Transactions Final)
              </Button>
              <Button
                variant="danger"
                onClick={() => handleBatchRemove("refund")}
                isLoading={batchLoading}
                className="w-full"
              >
                Refund All Purchases
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowBatchConfirm(false)}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {positions.length === 0 ? (
        <p className="text-center text-gray-500 py-8">No one in line yet.</p>
      ) : (
        <div className="space-y-2">
          {/* Select mode toggle for creators */}
          {isCreator && positions.length > 0 && (
            <div className="flex items-center justify-between pb-2">
              {selectMode ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      // Select all non-self positions
                      const allIds = positions
                        .filter((p) => p.user.id !== session?.user?.id)
                        .map((p) => p.id)
                      if (selectedIds.size === allIds.length) {
                        setSelectedIds(new Set())
                      } else {
                        setSelectedIds(new Set(allIds))
                      }
                    }}
                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {selectedIds.size === positions.filter((p) => p.user.id !== session?.user?.id).length
                      ? "Deselect All"
                      : "Select All"}
                  </button>
                  <span className="text-sm text-gray-500">
                    {selectedIds.size} selected
                  </span>
                </div>
              ) : (
                <div />
              )}
              <button
                onClick={() => {
                  if (selectMode) {
                    cancelSelectMode()
                  } else {
                    setSelectMode(true)
                  }
                }}
                className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                  selectMode
                    ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {selectMode ? "Done" : "Select"}
              </button>
            </div>
          )}

          {positions.map((pos) => {
            const isCurrentUser = pos.user.id === session?.user?.id
            const isLocked = pos.lockedUntil && new Date(pos.lockedUntil) > new Date()
            const isForSale = pos.askingPrice !== null && !isLocked
            const canBuy =
              positionInFront?.id === pos.id && pos.askingPrice !== null && !isLocked && !isPaused
            const isFront = pos.position === 1
            const isSelected = selectedIds.has(pos.id)
            const canSelect = selectMode && isCreator && !isCurrentUser

            // Left border accent: green for sale, amber for pending, transparent otherwise
            const leftBorder = isLocked
              ? "border-l-4 border-l-amber-400"
              : isForSale
              ? "border-l-4 border-l-green-400"
              : "border-l-4 border-l-transparent"

            return (
              <div
                key={pos.id}
                onClick={canSelect ? () => toggleSelection(pos.id) : undefined}
                className={`flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 rounded-lg border ${leftBorder} ${
                  isSelected
                    ? "bg-blue-50 border-blue-300 ring-1 ring-blue-300"
                    : isCurrentUser
                    ? "bg-blue-50 border-blue-200"
                    : isFront
                    ? "bg-green-50 border-green-200"
                    : isLocked
                    ? "bg-amber-50/50 border-amber-200"
                    : isForSale
                    ? "bg-white border-gray-200"
                    : "bg-white border-gray-200"
                } ${canSelect ? "cursor-pointer" : ""}`}
              >
                <div className="flex items-center space-x-4 min-w-0">
                  {canSelect && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelection(pos.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 flex-shrink-0"
                    />
                  )}
                  <div className={`w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center font-bold ${
                    isFront ? "bg-green-200 text-green-700" : "bg-gray-200 text-gray-600"
                  }`}>
                    {pos.position}
                  </div>
                  {pos.user.image ? (
                    <Image
                      src={pos.user.image}
                      alt={pos.user.name || "User"}
                      width={40}
                      height={40}
                      className="rounded-full flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 flex-shrink-0 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 font-medium">
                      {pos.user.name?.[0] || "?"}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {pos.user.name || "Anonymous"}
                      {isCurrentUser && (
                        <span className="ml-2 text-sm text-blue-600">(You)</span>
                      )}
                      {isFront && (
                        <span className="ml-2 text-sm text-green-600">(Next up)</span>
                      )}
                    </p>
                    {pos.askingPrice !== null && (() => {
                      const posFees = feeInfo ? calcFees(pos.askingPrice, feeInfo.ownerFeePercent, feeInfo.platformFeePercent) : { ownerFee: 0, platformFee: 0, total: pos.askingPrice }
                      const hasFees = posFees.ownerFee > 0 || posFees.platformFee > 0
                      return (
                        <p className={`text-sm font-medium flex items-center gap-1.5 ${isLocked ? "text-amber-600" : "text-green-600"}`}>
                          <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${isLocked ? "bg-amber-500" : "bg-green-500"}`} />
                          {isLocked ? "Pending" : "For sale"}: {formatCurrency(hasFees ? posFees.total : pos.askingPrice)}
                        </p>
                      )
                    })()}
                    {!isFront && waitTimeData?.estimatedMinutesPerPerson != null && (
                      <p className="text-xs text-gray-400">
                        Est. wait: {formatWaitTime(waitTimeData.estimatedMinutesPerPerson * (pos.position - 1))}
                      </p>
                    )}
                  </div>
                </div>

                {!selectMode && (
                <div className="flex items-center flex-wrap gap-2 mt-3 sm:mt-0 sm:ml-4 sm:flex-shrink-0">
                  {isCurrentUser && (
                    <>
                      {editingPrice === pos.id ? (
                        <div className="space-y-1 w-full sm:w-auto">
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1 sm:flex-none">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                value={priceInput[pos.id] || ""}
                                onChange={(e) =>
                                  setPriceInput({ ...priceInput, [pos.id]: e.target.value })
                                }
                                className="w-full sm:w-28 pl-6 pr-2 py-1 border rounded text-sm"
                              />
                            </div>
                            <Button
                              size="sm"
                              onClick={() => handleSetPrice(pos.id)}
                              isLoading={loadingAction === `price-${pos.id}`}
                            >
                              Set
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingPrice(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                          {priceInput[pos.id] && parseFloat(priceInput[pos.id]) > 0 && feeInfo && (feeInfo.ownerFeePercent > 0 || feeInfo.platformFeePercent > 0) && (() => {
                            const p = parseFloat(priceInput[pos.id])
                            const f = calcFees(p, feeInfo.ownerFeePercent, feeInfo.platformFeePercent)
                            return (
                              <p className="text-xs text-gray-500 pl-1">
                                You receive {formatCurrency(p)} · Buyer pays {formatCurrency(f.total)}
                                <span className="text-gray-400"> ({feeInfo.ownerFeePercent}% owner + {feeInfo.platformFeePercent}% platform fee)</span>
                              </p>
                            )
                          })()}
                        </div>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditingPrice(pos.id)
                              setPriceInput({
                                ...priceInput,
                                [pos.id]: pos.askingPrice?.toString() || "",
                              })
                            }}
                          >
                            {pos.askingPrice !== null ? "Change Price" : "Sell Position"}
                          </Button>
                          {pos.askingPrice !== null && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setPriceInput({ ...priceInput, [pos.id]: "" })
                                handleSetPrice(pos.id)
                              }}
                            >
                              Remove
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setShowLeaveConfirm(true)}
                            isLoading={loadingAction === "leave"}
                          >
                            Leave
                          </Button>
                        </>
                      )}
                    </>
                  )}
                  {canBuy && (() => {
                    const buyTotal = feeInfo ? calcFees(pos.askingPrice!, feeInfo.ownerFeePercent, feeInfo.platformFeePercent).total : pos.askingPrice!
                    return (
                      <Button
                        size="sm"
                        onClick={() => setShowBuyConfirm(true)}
                        isLoading={loadingAction === "buy"}
                      >
                        Buy for {formatCurrency(buyTotal)}
                      </Button>
                    )
                  })()}
                  {isCreator && !isCurrentUser && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => openRemovalModal(pos.id, pos.user.id, pos.user.name)}
                      isLoading={loadingAction === `remove-${pos.id}`}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Floating action bar for batch select mode */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-40 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              {selectedIds.size} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="danger"
                onClick={() => setShowBatchConfirm(true)}
                isLoading={batchLoading}
              >
                Remove All
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={cancelSelectMode}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
