"use client"

import Image from "next/image"
import { Button } from "./ui/Button"
import { ConfirmModal } from "./ui/ConfirmModal"
import { useToast } from "./ui/Toast"
import { useState } from "react"
import { useSession } from "next-auth/react"

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

interface QueueDisplayProps {
  lineId: string
  positions: Position[]
  onRefresh: () => void
  isCreator?: boolean
}

export function QueueDisplay({ lineId, positions, onRefresh, isCreator = false }: QueueDisplayProps) {
  const { data: session } = useSession()
  const { addToast } = useToast()
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [priceInput, setPriceInput] = useState<{ [key: string]: string }>({})
  const [editingPrice, setEditingPrice] = useState<string | null>(null)
  const [removalModal, setRemovalModal] = useState<RemovalModal | null>(null)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [showBuyConfirm, setShowBuyConfirm] = useState(false)

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
          addToast(`Refunded ${data.refundedCount} transaction(s) totaling $${data.refundedAmount.toFixed(2)}`, "success")
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
                    <span className="font-medium">Paid:</span> ${removalModal.transactionInfo.totalPaid.toFixed(2)}
                    <span className="text-gray-400 ml-1">({removalModal.transactionInfo.asBuyer.length} purchases)</span>
                  </p>
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Received:</span> ${removalModal.transactionInfo.totalReceived.toFixed(2)}
                    <span className="text-gray-400 ml-1">({removalModal.transactionInfo.asSeller.filter(t => t.status === "COMPLETED").length} sales)</span>
                  </p>
                  {(removalModal.transactionInfo.totalRefundedToBuyer > 0 || removalModal.transactionInfo.totalRefundedAsSeller > 0) && (
                    <p className="text-sm text-amber-600">
                      <span className="font-medium">Already Refunded:</span> ${(removalModal.transactionInfo.totalRefundedToBuyer + removalModal.transactionInfo.totalRefundedAsSeller).toFixed(2)}
                    </p>
                  )}
                  <p className="text-sm font-medium text-gray-900 mt-1 pt-1 border-t">
                    Net: ${removalModal.transactionInfo.netAmount.toFixed(2)}
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
                  Refund (${removalModal.transactionInfo.totalPaid.toFixed(2)} to buyer)
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
      <ConfirmModal
        open={showBuyConfirm}
        title="Buy Position"
        message={positionInFront?.askingPrice
          ? `Buy the position ahead of you for $${positionInFront.askingPrice.toFixed(2)}? You'll swap places with the person in front.`
          : "Buy the position ahead of you?"}
        confirmLabel={positionInFront?.askingPrice ? `Pay $${positionInFront.askingPrice.toFixed(2)}` : "Buy"}
        variant="primary"
        isLoading={loadingAction === "buy"}
        onConfirm={handleBuy}
        onCancel={() => setShowBuyConfirm(false)}
      />

      {positions.length === 0 ? (
        <p className="text-center text-gray-500 py-8">No one in line yet.</p>
      ) : (
        <div className="space-y-2">
          {positions.map((pos) => {
            const isCurrentUser = pos.user.id === session?.user?.id
            const isLocked = pos.lockedUntil && new Date(pos.lockedUntil) > new Date()
            const canBuy =
              positionInFront?.id === pos.id && pos.askingPrice !== null && !isLocked
            const isFront = pos.position === 1

            return (
              <div
                key={pos.id}
                className={`flex items-center justify-between p-4 rounded-lg border ${
                  isCurrentUser
                    ? "bg-blue-50 border-blue-200"
                    : isFront
                    ? "bg-green-50 border-green-200"
                    : "bg-white border-gray-200"
                }`}
              >
                <div className="flex items-center space-x-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
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
                      className="rounded-full"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 font-medium">
                      {pos.user.name?.[0] || "?"}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-gray-900">
                      {pos.user.name || "Anonymous"}
                      {isCurrentUser && (
                        <span className="ml-2 text-sm text-blue-600">(You)</span>
                      )}
                      {isFront && (
                        <span className="ml-2 text-sm text-green-600">(Next up)</span>
                      )}
                    </p>
                    {pos.askingPrice !== null && (
                      <p className={`text-sm font-medium ${isLocked ? "text-orange-600" : "text-green-600"}`}>
                        For sale: ${pos.askingPrice.toFixed(2)}
                        {isLocked && <span className="ml-1">(pending)</span>}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {isCurrentUser && (
                    <>
                      {editingPrice === pos.id ? (
                        <div className="flex items-center space-x-2">
                          <div className="relative">
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
                              className="w-28 pl-6 pr-2 py-1 border rounded text-sm"
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
                  {canBuy && (
                    <Button
                      size="sm"
                      onClick={() => setShowBuyConfirm(true)}
                      isLoading={loadingAction === "buy"}
                    >
                      Buy for ${pos.askingPrice!.toFixed(2)}
                    </Button>
                  )}
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
