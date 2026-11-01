"use client"

import Image from "next/image"
import { callDeadline, timeLeft } from "@/lib/call-deadline"
import { useDialog } from "@/lib/use-dialog"
import { Button } from "./ui/Button"
import { ConfirmModal } from "./ui/ConfirmModal"
import { useToast } from "./ui/Toast"
import { useState, useEffect, useCallback } from "react"
import { useSession } from "next-auth/react"
import { formatCurrency } from "@/lib/format"
import { calcFees } from "@/lib/fees"
import { formatWaitTime } from "@/lib/wait-time"
import { MAX_PARTY_SIZE } from "@/lib/capacity"

interface Position {
  id: string
  position: number
  askingPrice: number | null
  lockedUntil: string | null
  fulfilled?: boolean
  fulfilledAt?: string | null
  calledAt?: string | null
  partySize?: number
  /** What they told the host after being called; owner and self only */
  response?: "ON_MY_WAY" | "RUNNING_LATE" | null
  respondedAt?: string | null
  /** Only sent to the owner and to the party itself */
  note?: string | null
  quotedMinutes?: number | null
  quotedAt?: string | null
  joinedAt?: string
  user: {
    id: string
    name: string | null
    image: string | null
    /** Added by the host at the stand; has no account */
    isWalkIn?: boolean
  }
}

interface SwapOffer {
  id: string
  lineId: string
  fromUserId: string
  toUserId: string
  amount: number
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "WITHDRAWN"
  createdAt: string
  expiresAt?: string | null
  awaitingPayment?: boolean
}

interface BuyConfirm {
  positionId: string
  sellerId: string
  sellerName: string | null
  position: number
  askingPrice: number
}

/** Waits a host typically quotes at the stand, in minutes */
const QUOTE_CHOICES = [5, 10, 15, 20, 25, 30, 45, 60, 75, 90, 120]

function formatTimeLeft(iso: string): string {
  const minutes = Math.max(0, (new Date(iso).getTime() - Date.now()) / 60000)
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`
  return `${Math.round(minutes / 60)} hr`
}

interface TransactionInfo {
  totalPaid: number
  totalReceived: number
  netAmount: number
  /** Purchases still held (not paid out): the only ones a removal can refund */
  refundableCount: number
  refundableAmount: number
  totalRefundedToBuyer: number
  totalRefundedAsSeller: number
  asBuyer: { id: string; amount: number; status: string }[]
  asSeller: { id: string; amount: number; status: string }[]
  downstreamBuyers: { id: string; name: string | null; amount: number; transactionId: string }[]
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
  hasPayoutSetup?: boolean
  stripeEnabled?: boolean
  allowResale?: boolean
  maxAskingPrice?: number | null
  hideCapacity?: boolean
  nowServingUserId?: string | null
  /** Restaurant lines show party sizes and let the host call any party */
  isRestaurant?: boolean
  /** Called after the viewer leaves the line from this page */
  onLeft?: () => void
  /** Notification emails are set up, so serving someone emails them */
  emailEnabled?: boolean
  /** Minutes a called person has to show up (owner sees the countdown) */
  responseWindowMinutes?: number | null
}

/** Format estimated wait time into a human-readable string */
/** How long a party has actually waited: "12 min", "1 hr 5 min" */
function formatWaited(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)} hr${rest ? ` ${rest} min` : ""}`
}

export function QueueDisplay({ lineId, positions, onRefresh, isCreator = false, feeInfo, isPaused = false, hasPayoutSetup = false, stripeEnabled = false, allowResale = true, maxAskingPrice = null, hideCapacity = false, nowServingUserId = null, isRestaurant = false, onLeft, responseWindowMinutes = null, emailEnabled = false }: QueueDisplayProps) {
  const { data: session } = useSession()
  const { addToast } = useToast()
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [removalModal, setRemovalModal] = useState<RemovalModal | null>(null)
  const removalDialogRef = useDialog(!!removalModal, () => setRemovalModal(null))
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  // Seating collects held payments and serving emails the person, and
  // neither can be undone, so the host confirms first.
  const [fulfillConfirm, setFulfillConfirm] = useState<{ positionId: string; name: string } | null>(null)
  const [waitTimeData, setWaitTimeData] = useState<{ estimatedMinutesPerPerson: number | null; basedOn: number } | null>(null)
  const [connectLoading, setConnectLoading] = useState(false)

  // Offer system state
  const [sentOffers, setSentOffers] = useState<SwapOffer[]>([])
  const [receivedOffers, setReceivedOffers] = useState<SwapOffer[]>([])
  const [offerFormOpen, setOfferFormOpen] = useState<string | null>(null)
  const [offerAmount, setOfferAmount] = useState("")
  const [offerLoading, setOfferLoading] = useState(false)
  const [buyConfirm, setBuyConfirm] = useState<BuyConfirm | null>(null)
  const buyDialogRef = useDialog(!!buyConfirm, () => setBuyConfirm(null))

  // Listing-for-sale state (the current user's own position)
  const [listPriceFormOpen, setListPriceFormOpen] = useState(false)
  const [listPriceAmount, setListPriceAmount] = useState("")
  const [priceLoading, setPriceLoading] = useState(false)

  // Batch select state
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBatchConfirm, setShowBatchConfirm] = useState(false)
  const batchDialogRef = useDialog(showBatchConfirm, () => setShowBatchConfirm(false))
  const [batchLoading, setBatchLoading] = useState(false)
  // Ticks so the host's "waiting 12 min" labels keep up between polls
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    if (!isCreator) return
    const timer = setInterval(() => setClock(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [isCreator])

  const fetchWaitTime = useCallback(async () => {
    try {
      const res = await fetch(`/api/lines/${lineId}/wait-time`)
      if (res.ok) {
        const data = await res.json()
        setWaitTimeData(data)
      }
    } catch {
      // Silently fail
    }
  }, [lineId])

  const fetchOffers = useCallback(async () => {
    if (!session?.user?.id) return
    try {
      const res = await fetch(`/api/lines/${lineId}/offer`)
      if (res.ok) {
        const data = await res.json()
        setSentOffers(data.sent)
        setReceivedOffers(data.received)
      }
    } catch {
      // Silently fail
    }
  }, [lineId, session?.user?.id])

  useEffect(() => {
    fetchWaitTime()
  }, [fetchWaitTime, positions.length])

  useEffect(() => {
    fetchOffers()
  }, [fetchOffers, positions.length])

  // Poll for offer status changes (e.g. the person in front accepting your
  // offer) even when nothing else on the page has changed.
  // Only people in the line can send or receive offers, and a hidden tab
  // doesn't need them (each poll scans the line's positions).
  const viewerInLine = !!session?.user?.id && positions.some((p) => p.user.id === session.user.id)
  useEffect(() => {
    if (!viewerInLine) return
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchOffers()
    }, 10000)
    return () => clearInterval(interval)
  }, [fetchOffers, viewerInLine])

  /** What a buyer actually pays for a listed position, including owner + platform fees. */
  function buyerTotal(askingPrice: number): number {
    if (!feeInfo) return askingPrice
    return calcFees(askingPrice, feeInfo.ownerFeePercent, feeInfo.platformFeePercent).total
  }

  function feeBreakdown(price: number) {
    if (!feeInfo) return { ownerFee: 0, platformFee: 0, total: price }
    return calcFees(price, feeInfo.ownerFeePercent, feeInfo.platformFeePercent)
  }

  const currentUserPosition = positions.find((p) => p.user.id === session?.user?.id)
  const positionInFront = currentUserPosition
    ? positions.find((p) => p.position === currentUserPosition.position - 1)
    : null

  // Called-up and served spots are off the market (the server enforces it too).
  const offMarket = (p: Position) => !!p.fulfilled || !!p.calledAt || p.user.id === nowServingUserId

  // Find the sent offer for the person directly in front
  const sentOfferToFront = positionInFront
    ? sentOffers.find((o) => o.toUserId === positionInFront.user.id)
    : null

  async function handleSendOffer(toUserId: string) {
    const amount = parseFloat(offerAmount)
    if (!amount || amount < 1) {
      addToast("Offers must be at least $1.00", "error")
      return
    }
    if (maxAskingPrice != null && amount > maxAskingPrice) {
      addToast(`Amount exceeds max price of ${formatCurrency(maxAskingPrice)}`, "error")
      return
    }

    setOfferLoading(true)
    try {
      const res = await fetch(`/api/lines/${lineId}/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId, amount }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast("Offer sent", "success")
        setOfferFormOpen(null)
        setOfferAmount("")
        fetchOffers()
      } else {
        addToast(data.error || "Failed to send offer", "error")
      }
    } finally {
      setOfferLoading(false)
    }
  }

  async function handleRespondToOffer(offerId: string, action: "accept" | "decline") {
    setLoadingAction(`offer-${offerId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/offer/${offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (res.ok) {
        if (action === "accept") {
          if (data.devMode) {
            addToast("Swap completed!", "success")
          } else if (data.pendingBuyerPayment) {
            // Payment is on the buyer, not us — we just wait for them now.
            addToast("Offer accepted — waiting for the buyer to complete payment.", "success")
          }
        } else {
          addToast("Offer declined", "info")
        }
        fetchOffers()
        onRefresh()
      } else {
        addToast(data.error || "Failed to respond to offer", "error")
      }
    } finally {
      setLoadingAction(null)
    }
  }

  /**
   * Buy a listed position outright (the person directly in front of you).
   * Sends the price and seller the buyer actually saw, so a re-price or a
   * queue shift between viewing and clicking is rejected, not charged.
   */
  async function handleBuyPosition(confirm: BuyConfirm) {
    setBuyConfirm(null)
    setLoadingAction(`buy-${confirm.positionId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedPrice: confirm.askingPrice,
          expectedSellerId: confirm.sellerId,
          ...(feeInfo ? { expectedTotal: buyerTotal(confirm.askingPrice) } : {}),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.url) {
          window.location.href = data.url
          return
        }
        addToast("Position purchased!", "success")
        onRefresh()
      } else {
        addToast(data.error || "Failed to buy position", "error")
        if (res.status === 409) onRefresh()
      }
    } finally {
      setLoadingAction(null)
    }
  }

  /** Withdraw a pending offer, or back out of one that was accepted but not yet paid. */
  async function handleWithdrawOffer(offerId: string) {
    setLoadingAction(`withdraw-${offerId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/offer/${offerId}`, { method: "DELETE" })
      const data = await res.json()
      if (res.ok) {
        addToast("Offer withdrawn", "info")
        fetchOffers()
        onRefresh()
      } else {
        addToast(data.error || "Failed to withdraw offer", "error")
      }
    } finally {
      setLoadingAction(null)
    }
  }

  /** Once the person in front has accepted your offer, fetch the payment link that's actually yours to use. */
  async function handleCompletePayment(offerId: string) {
    setLoadingAction(`pay-${offerId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/offer/${offerId}/checkout`)
      const data = await res.json()
      if (res.ok && data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return
      }
      addToast(data.error || "Could not start payment", "error")
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleConnectSetup() {
    setConnectLoading(true)
    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: window.location.pathname }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        window.location.href = data.url
      } else {
        addToast(data.error || "Failed to start payout setup", "error")
        setConnectLoading(false)
      }
    } catch {
      addToast("Failed to start payout setup", "error")
      setConnectLoading(false)
    }
  }

  /** List, re-price, or un-list the current user's own position. */
  async function handleSetPrice(price: number | null) {
    if (price !== null && (!price || price < 1)) {
      addToast("Price must be at least $1.00", "error")
      return
    }
    if (price !== null && maxAskingPrice != null && price > maxAskingPrice) {
      addToast(`Price exceeds max price of ${formatCurrency(maxAskingPrice)}`, "error")
      return
    }
    setPriceLoading(true)
    try {
      const res = await fetch(`/api/lines/${lineId}/price`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(
          price === null ? "Removed from sale" : `Listed for ${formatCurrency(price)}`,
          "success"
        )
        setListPriceFormOpen(false)
        setListPriceAmount("")
        onRefresh()
      } else {
        addToast(data.error || "Failed to update listing", "error")
      }
    } finally {
      setPriceLoading(false)
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
        onLeft?.()
        addToast("You left the line", "info")
        onRefresh()
      } else {
        const data = await res.json().catch(() => ({}))
        addToast(data.error || "Couldn't leave the line. Please try again.", "error")
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

  async function handleRemoveWithAction(action: "payout" | "refund", noShow = false) {
    if (!removalModal) return

    setLoadingAction(`remove-${removalModal.positionId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/remove-position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionId: removalModal.positionId,
          action,
          ...(noShow && { noShow: true }),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.refundFailedCount > 0) {
          addToast(
            `Removed, but ${data.refundFailedCount} refund(s) didn't go through. They're still open on the settlement page.`,
            "error"
          )
        } else if (data.collectFailedCount > 0) {
          addToast(
            `Removed, but ${data.collectFailedCount} payment(s) couldn't be collected. Review them on the settlement page.`,
            "info"
          )
        } else if (data.refundedCount > 0) {
          addToast(`Removed and refunded ${formatCurrency(data.refundedAmount)} to the buyer`, "success")
        } else {
          addToast(noShow ? "Marked as a no-show and removed" : "Person removed from line", "success")
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

  async function handleCall(positionId: string) {
    setLoadingAction(`call-${positionId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/call-next`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast(`Called ${data.calledUser} (party of ${data.partySize})`, "success")
        onRefresh()
      } else {
        addToast(data.error || "Failed to call this party", "error")
      }
    } finally {
      setLoadingAction(null)
    }
  }

  async function handlePartySize(partySize: number, positionId?: string) {
    setLoadingAction(positionId ? `party-size-${positionId}` : "party-size")
    try {
      const res = await fetch(`/api/lines/${lineId}/party`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // The host names the party; a guest changes their own
        body: JSON.stringify(positionId ? { partySize, positionId } : { partySize }),
      })
      if (res.ok) {
        addToast(`Updated to a party of ${partySize}`, "success")
        onRefresh()
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to update your party size", "error")
      }
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleNote(note: string, positionId?: string) {
    setLoadingAction(positionId ? `note-${positionId}` : "note")
    try {
      const res = await fetch(`/api/lines/${lineId}/party`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(positionId ? { note, positionId } : { note }),
      })
      if (res.ok) {
        addToast(note.trim() ? "Note saved" : "Note removed", "success")
        onRefresh()
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to save the note", "error")
      }
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleQuote(positionId: string, minutes: number | null) {
    setLoadingAction(`quote-${positionId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId, minutes }),
      })
      if (res.ok) {
        addToast(minutes ? `Quoted about ${minutes} min` : "Quote cleared", "success")
        onRefresh()
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to save the quote", "error")
      }
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleFulfill(positionId: string) {
    setLoadingAction(`fulfill-${positionId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/fulfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId }),
      })
      if (res.ok) {
        const data = await res.json()
        const payoutMsg = data.payoutsReleased > 0
          ? ` (${data.payoutsReleased} payout${data.payoutsReleased === 1 ? "" : "s"} released)`
          : ""
        addToast(`${isRestaurant ? "Marked as seated" : "Marked as served"}${payoutMsg}`, "success")
        if (data.payoutsFailed > 0) {
          addToast(
            `${data.payoutsFailed} payment${data.payoutsFailed === 1 ? "" : "s"} couldn't be collected -- review on the settlement page.`,
            "error"
          )
        }
        onRefresh()
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to fulfill", "error")
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
        let msg = data.failed > 0
          ? `Removed ${data.removed}, ${data.failed} failed.`
          : `Removed ${data.removed} ${data.removed === 1 ? "person" : "people"} from line.`
        if (data.refundedCount > 0) msg += ` Refunded ${formatCurrency(data.refundedAmount)}.`
        const moneyProblems = (data.refundFailedCount ?? 0) + (data.collectFailedCount ?? 0)
        if (moneyProblems > 0) msg += ` ${moneyProblems} payment(s) need attention on the settlement page.`
        addToast(msg, data.failed > 0 || moneyProblems > 0 ? "info" : "success")
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div ref={removalDialogRef} className="bg-white border border-ink p-6 max-w-md w-full mx-4" role="dialog" aria-modal="true" aria-label={`Remove ${removalModal.userName || "this person"}`}>
            <h3 className="text-lg font-semibold tracking-tight text-ink mb-4">
              Remove {removalModal.userName || "this person"}?
            </h3>

            {removalModal.loading ? (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ink mx-auto"></div>
                <p className="text-sm text-ink/50 mt-2">Loading transaction history...</p>
              </div>
            ) : removalModal.transactionInfo ? (
              <div className="space-y-3 mb-4">
                <div className="bg-paper border border-rule p-3">
                  <p className="text-sm text-ink/60">
                    <span className="font-medium text-ink">Paid:</span> <span className="font-mono tabular-nums">{formatCurrency(removalModal.transactionInfo.totalPaid)}</span>
                    <span className="text-ink/40 ml-1">({removalModal.transactionInfo.asBuyer.length} purchases)</span>
                  </p>
                  <p className="text-sm text-ink/60">
                    <span className="font-medium text-ink">Received:</span> <span className="font-mono tabular-nums">{formatCurrency(removalModal.transactionInfo.totalReceived)}</span>
                    <span className="text-ink/40 ml-1">({removalModal.transactionInfo.asSeller.filter(t => t.status === "COMPLETED").length} sales)</span>
                  </p>
                  {(removalModal.transactionInfo.totalRefundedToBuyer > 0 || removalModal.transactionInfo.totalRefundedAsSeller > 0) && (
                    <p className="text-sm text-amber-600">
                      <span className="font-medium">Already Refunded:</span> {formatCurrency(removalModal.transactionInfo.totalRefundedToBuyer + removalModal.transactionInfo.totalRefundedAsSeller)}
                    </p>
                  )}
                  <p className="text-sm font-medium text-ink mt-1 pt-1 border-t border-rule">
                    Net: {formatCurrency(removalModal.transactionInfo.netAmount)}
                  </p>
                </div>

                {removalModal.transactionInfo.downstreamBuyers.length > 0 && (
                  <div className="border border-rule border-l-2 border-l-amber-600 bg-white p-3">
                    <p className="text-sm font-medium text-ink mb-2">
                      Buyers who purchased from this person:
                    </p>
                    <ul className="space-y-1">
                      {removalModal.transactionInfo.downstreamBuyers.map((buyer) => (
                        <li key={buyer.transactionId} className="flex items-center justify-between text-sm">
                          <span className="text-ink/70">{buyer.name || "Anonymous"}</span>
                          <span className="text-ink font-mono tabular-nums">{formatCurrency(buyer.amount)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-amber-600 mt-2">
                      Removing this person may affect these buyers. Consider refunding if the removal invalidates their purchase.
                    </p>
                  </div>
                )}

                {removalModal.transactionInfo.refundableCount > 0 ? (
                  <p className="text-sm text-ink/60">
                    {formatCurrency(removalModal.transactionInfo.refundableAmount)} they paid for spots is still on hold.
                    Keep the purchase to collect it and pay the people they bought from, or refund it.
                  </p>
                ) : removalModal.transactionInfo.asBuyer.some(t => t.status === "COMPLETED") ? (
                  <p className="text-sm text-ink/60">
                    Their purchases have already been paid out and can&apos;t be refunded here.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-ink/60 mb-4">
                Couldn&apos;t load their payments. Removing them now keeps any purchases they made.
              </p>
            )}

            <div className="flex flex-col space-y-2">
              <Button
                onClick={() => handleRemoveWithAction("payout")}
                isLoading={loadingAction === `remove-${removalModal.positionId}`}
                disabled={removalModal.loading}
                className="w-full"
              >
                {removalModal.transactionInfo && removalModal.transactionInfo.refundableCount > 0
                  ? "Remove and keep purchase"
                  : "Remove"}
              </Button>
              {removalModal.transactionInfo && removalModal.transactionInfo.refundableCount > 0 && (
                <Button
                  variant="danger"
                  onClick={() => handleRemoveWithAction("refund")}
                  isLoading={loadingAction === `remove-${removalModal.positionId}`}
                  className="w-full"
                >
                  Remove and refund {formatCurrency(removalModal.transactionInfo.refundableAmount)}
                </Button>
              )}
              {/* Recorded separately from other removals; purchases are kept */}
              <Button
                variant="secondary"
                onClick={() => handleRemoveWithAction("payout", true)}
                isLoading={loadingAction === `remove-${removalModal.positionId}`}
                disabled={removalModal.loading}
                className="w-full"
              >
                No-show{removalModal.transactionInfo && removalModal.transactionInfo.refundableCount > 0 ? " (keep purchase)" : ""}
              </Button>
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

      {/* Buy confirmation: exactly who, which spot, and where the money goes */}
      {buyConfirm && (() => {
        const breakdown = feeBreakdown(buyConfirm.askingPrice)
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div ref={buyDialogRef} className="bg-white border border-ink p-6 max-w-sm w-full mx-4" role="dialog" aria-modal="true" aria-label="Confirm purchase">
              <h3 className="text-lg font-semibold tracking-tight text-ink mb-2">
                Buy spot #{buyConfirm.position}?
              </h3>
              <p className="text-sm text-ink/60 mb-4">
                You&apos;ll swap places with {buyConfirm.sellerName || "the person in front of you"}.
                {stripeEnabled && (isRestaurant
                  ? " Your card is held, not charged, until you're seated. It's charged when you're seated or if you leave; the host can release it if you aren't seated."
                  : " This purchase is final: you're charged now and the seller is paid right away, even if you leave or are removed later.")}
              </p>
              <dl className="text-sm border border-rule divide-y divide-rule mb-4">
                <div className="flex justify-between px-3 py-1.5">
                  <dt className="text-ink/60">To {buyConfirm.sellerName || "seller"}</dt>
                  <dd className="font-mono tabular-nums">{formatCurrency(buyConfirm.askingPrice)}</dd>
                </div>
                {breakdown.ownerFee > 0 && (
                  <div className="flex justify-between px-3 py-1.5">
                    <dt className="text-ink/60">Line owner fee</dt>
                    <dd className="font-mono tabular-nums">{formatCurrency(breakdown.ownerFee)}</dd>
                  </div>
                )}
                {breakdown.platformFee > 0 && (
                  <div className="flex justify-between px-3 py-1.5">
                    <dt className="text-ink/60">Platform fee</dt>
                    <dd className="font-mono tabular-nums">{formatCurrency(breakdown.platformFee)}</dd>
                  </div>
                )}
                <div className="flex justify-between px-3 py-1.5 font-medium text-ink">
                  <dt>You pay</dt>
                  <dd className="font-mono tabular-nums">{formatCurrency(breakdown.total)}</dd>
                </div>
              </dl>
              <div className="flex flex-col space-y-2">
                <Button onClick={() => handleBuyPosition(buyConfirm)} className="w-full">
                  {stripeEnabled ? "Continue to Payment" : "Confirm Swap"}
                </Button>
                <Button variant="ghost" onClick={() => setBuyConfirm(null)} className="w-full">
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Seat / serve confirmation */}
      <ConfirmModal
        open={!!fulfillConfirm}
        title={isRestaurant ? "Mark as seated" : "Mark as served"}
        message={fulfillConfirm
          ? isRestaurant
            ? `Seat ${fulfillConfirm.name}? Any swap payment of theirs on hold is collected now. This can't be undone.`
            : `Mark ${fulfillConfirm.name} as served?${emailEnabled ? ` They'll get a "you've been served" email.` : ""} This can't be undone.`
          : ""}
        confirmLabel={isRestaurant ? "Seated" : "Served"}
        isLoading={!!fulfillConfirm && loadingAction === `fulfill-${fulfillConfirm.positionId}`}
        onConfirm={async () => {
          if (!fulfillConfirm) return
          await handleFulfill(fulfillConfirm.positionId)
          setFulfillConfirm(null)
        }}
        onCancel={() => setFulfillConfirm(null)}
      />

      {/* Leave Confirmation */}
      <ConfirmModal
        open={showLeaveConfirm}
        title="Leave Line"
        message={isRestaurant
          ? "Are you sure you want to leave this line? You'll lose your place. If you bought a spot, your card is charged for it now -- leaving doesn't release the hold or refund it."
          : "Are you sure you want to leave this line? You'll lose your place. Spots you bought stay paid for -- leaving doesn't refund them."}
        confirmLabel="Leave Line"
        variant="danger"
        isLoading={loadingAction === "leave"}
        onConfirm={handleLeave}
        onCancel={() => setShowLeaveConfirm(false)}
      />

      {/* Batch Remove Confirm Modal */}
      {showBatchConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div ref={batchDialogRef} className="bg-white border border-ink p-6 max-w-sm w-full mx-4" role="dialog" aria-modal="true" aria-label="Remove selected people">
            <h3 className="text-lg font-semibold tracking-tight text-ink mb-2">
              Remove {selectedIds.size} {selectedIds.size === 1 ? "person" : "people"}?
            </h3>
            <p className="text-sm text-ink/60 mb-4">
              {isRestaurant
                ? "Any of their payments still on hold can be kept (collected and paid out) or refunded. Payments already collected are final."
                : "Swaps on this line are paid out as they happen, so purchases are final. Only a payment that couldn't be collected can still be refunded."}
            </p>
            <div className="flex flex-col space-y-2">
              <Button
                onClick={() => handleBatchRemove("payout")}
                isLoading={batchLoading}
                className="w-full"
              >
                Remove and keep purchases
              </Button>
              <Button
                variant="danger"
                onClick={() => handleBatchRemove("refund")}
                isLoading={batchLoading}
                className="w-full"
              >
                Remove and refund held payments
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

      {/* Resale disabled note */}
      {!allowResale && positions.length > 0 && (
        <div className="bg-white border border-rule px-4 py-2.5">
          <p className="text-sm text-ink/50">Swapping is disabled for this line</p>
        </div>
      )}

      {positions.length === 0 ? (
        <p className="text-center text-ink/40 py-8">No one in line yet.</p>
      ) : (
        <div className="space-y-2">
          {/* Select mode toggle for creators */}
          {isCreator && positions.length > 0 && (
            <div className="flex items-center justify-between pb-2">
              {selectMode ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      const allIds = positions
                        .filter((p) => p.user.id !== session?.user?.id)
                        .map((p) => p.id)
                      if (selectedIds.size === allIds.length) {
                        setSelectedIds(new Set())
                      } else {
                        setSelectedIds(new Set(allIds))
                      }
                    }}
                    className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
                  >
                    {selectedIds.size === positions.filter((p) => p.user.id !== session?.user?.id).length
                      ? "Deselect All"
                      : "Select All"}
                  </button>
                  <span className="font-mono text-xs uppercase tracking-widest text-ink/40 tabular-nums">
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
                className={`font-mono text-xs uppercase tracking-widest px-3 py-1.5 border transition-colors ${
                  selectMode
                    ? "border-ink bg-ink text-paper"
                    : "border-transparent text-ink/60 hover:text-ink hover:bg-ink/5"
                }`}
              >
                {selectMode ? "Done" : "Select"}
              </button>
            </div>
          )}

          <div className="border border-rule divide-y divide-rule">
          {positions.map((pos) => {
            const isCurrentUser = pos.user.id === session?.user?.id
            const isLocked = pos.lockedUntil && new Date(pos.lockedUntil) > new Date()
            // Served people stay listed until cleared, so the front of the
            // queue is the first unserved person, not position 1.
            const unservedAhead = positions.filter((p) => p.position < pos.position && !p.fulfilled).length
            const isFront = !pos.fulfilled && unservedAhead === 0
            const isSelected = selectedIds.has(pos.id)
            const canSelect = selectMode && isCreator && !isCurrentUser
            const isDirectlyInFront = positionInFront?.id === pos.id
            const hasIncomingOffer = isCurrentUser && receivedOffers.some((o) => o.status === "PENDING")

            const leftBorder = hasIncomingOffer
              ? "border-l-2 border-l-amber-600"
              : isLocked
              ? "border-l-2 border-l-amber-600"
              : isCurrentUser
              ? "border-l-2 border-l-accent"
              : "border-l-2 border-l-transparent"

            return (
              <div
                key={pos.id}
                onClick={canSelect ? () => toggleSelection(pos.id) : undefined}
                className={`flex flex-col px-4 py-3 ${leftBorder} ${
                  isSelected ? "bg-ink/5" : isCurrentUser ? "bg-paper" : "bg-white"
                } ${canSelect ? "cursor-pointer" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4 min-w-0">
                    {canSelect && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelection(pos.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 accent-ink border-rule flex-shrink-0"
                      />
                    )}
                    <div className={`w-8 flex-shrink-0 font-mono tabular-nums text-lg text-right ${
                      isFront ? "text-accent" : "text-ink/40"
                    }`}>
                      {pos.position}
                    </div>
                    {pos.user.image ? (
                      <Image
                        src={pos.user.image}
                        alt={pos.user.name || "User"}
                        width={40}
                        height={40}
                        className="w-10 h-10 object-cover border border-rule flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 flex-shrink-0 bg-ink/10 border border-rule flex items-center justify-center text-ink/60 font-medium">
                        {pos.user.name?.[0] || "?"}
                      </div>
                    )}
                    <div className="min-w-0">
                      {/* Only the name truncates; the labels wrap onto the next
                          line on narrow screens instead of being cut off. */}
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                        <span className="font-medium text-ink truncate max-w-full">
                          {pos.user.name || (isCreator ? "Anonymous" : "Someone")}
                        </span>
                        {isCurrentUser && (
                          <span className="text-sm text-accent">(You)</span>
                        )}
                        {pos.user.isWalkIn && (
                          <span className="font-mono text-xs uppercase tracking-widest text-ink/50">Walk-in</span>
                        )}
                        {isFront && !pos.fulfilled && !pos.calledAt && (
                          <span className="text-sm text-green-700">(Next up)</span>
                        )}
                        {pos.calledAt && !pos.fulfilled && (
                          <span className="font-mono text-xs uppercase tracking-widest text-green-700">Called</span>
                        )}
                        {pos.calledAt && !pos.fulfilled && pos.response && (
                          <span className={`font-mono text-xs uppercase tracking-widest ${pos.response === "ON_MY_WAY" ? "text-green-700" : "text-amber-600"}`}>
                            {pos.response === "ON_MY_WAY" ? "On the way" : "Running late"}
                          </span>
                        )}
                        {isCreator && !pos.fulfilled && pos.joinedAt && (() => {
                          const waited = Math.max(0, Math.floor((clock - new Date(pos.joinedAt).getTime()) / 60_000))
                          const overQuote =
                            pos.quotedMinutes != null &&
                            pos.quotedAt != null &&
                            clock - new Date(pos.quotedAt).getTime() > pos.quotedMinutes * 60_000
                          return (
                            <span className={`text-xs ${overQuote ? "text-amber-600" : "text-ink/50"}`}>
                              waiting {formatWaited(waited)}{overQuote && " · past quote"}
                            </span>
                          )
                        })()}
                        {isCreator && pos.calledAt && !pos.fulfilled && responseWindowMinutes && !pos.user.isWalkIn && !isPaused && (() => {
                          const left = timeLeft(callDeadline(pos.calledAt, responseWindowMinutes, pos.respondedAt))
                          return left ? <span className="text-xs text-ink/50">{left} left to show up</span> : null
                        })()}
                        {pos.askingPrice != null && !isCurrentUser && (
                          <span className="font-mono text-xs uppercase tracking-widest text-accent">
                            Listed {formatCurrency(pos.askingPrice)}
                          </span>
                        )}
                        {pos.askingPrice != null &&
                          !isCurrentUser &&
                          !isDirectlyInFront &&
                          currentUserPosition &&
                          pos.position < currentUserPosition.position && (
                            <span className="text-xs text-ink/40 normal-case">
                              (only the person directly behind can buy this)
                            </span>
                          )}
                        {pos.fulfilled && (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-green-700">
                            <span className="w-1.5 h-1.5 bg-green-600" aria-hidden />
                            {isRestaurant ? "Seated" : "Served"}
                          </span>
                        )}
                      </div>
                      {isRestaurant && (
                        // Guests change their own size until they're called;
                        // the host can change any party's size until it's seated.
                        !pos.fulfilled && ((isCurrentUser && !pos.calledAt) || (isCreator && !isCurrentUser)) ? (
                          <label className="flex items-center gap-1.5 text-xs text-ink/60 mt-0.5">
                            Party of
                            <select
                              value={pos.partySize ?? 1}
                              onChange={(e) => handlePartySize(Number(e.target.value), isCurrentUser ? undefined : pos.id)}
                              disabled={loadingAction === (isCurrentUser ? "party-size" : `party-size-${pos.id}`)}
                              className="border border-rule bg-white px-1 py-0.5 text-ink"
                              aria-label={isCurrentUser ? "Your party size" : `Party size for ${pos.user.name || "this party"}`}
                            >
                              {Array.from({ length: MAX_PARTY_SIZE }, (_, i) => i + 1).map((n) => (
                                <option key={n} value={n}>{n}</option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <p className="text-xs text-ink/60 mt-0.5">Party of {pos.partySize ?? 1}</p>
                        )
                      )}
                      {isRestaurant && !pos.fulfilled && (isCurrentUser || isCreator) && (
                        <NoteField
                          key={`${pos.id}-${pos.note ?? ""}`}
                          initial={pos.note ?? ""}
                          label={isCurrentUser ? "Note for the host" : `Note for ${pos.user.name || "this party"}`}
                          saving={loadingAction === (isCurrentUser ? "note" : `note-${pos.id}`)}
                          onSave={(note) => handleNote(note, isCurrentUser ? undefined : pos.id)}
                        />
                      )}
                      {isRestaurant && pos.fulfilled && pos.note && (isCurrentUser || isCreator) && (
                        <p className="text-xs text-ink/50 mt-0.5">Note: {pos.note}</p>
                      )}
                      {isCreator && !isCurrentUser && !pos.fulfilled && (
                        <label className="flex items-center gap-1.5 text-xs text-ink/60 mt-0.5">
                          Quote
                          <select
                            value={pos.quotedMinutes ?? ""}
                            onChange={(e) => handleQuote(pos.id, e.target.value ? Number(e.target.value) : null)}
                            disabled={loadingAction === `quote-${pos.id}`}
                            className="border border-rule bg-white px-1 py-0.5 text-ink"
                            aria-label={`Quoted wait for ${pos.user.name || "this party"}`}
                          >
                            <option value="">--</option>
                            {[...new Set([...QUOTE_CHOICES, ...(pos.quotedMinutes ? [pos.quotedMinutes] : [])])]
                              .sort((a, b) => a - b)
                              .map((m) => (
                                <option key={m} value={m}>{m} min</option>
                              ))}
                          </select>
                          {pos.quotedAt && (
                            <span className="text-ink/40">
                              at {new Date(pos.quotedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                            </span>
                          )}
                        </label>
                      )}
                      {isLocked && (
                        <p className="font-mono text-xs uppercase tracking-widest text-amber-600 flex items-center gap-1.5 mt-0.5">
                          <span className="inline-block w-1.5 h-1.5 flex-shrink-0 bg-amber-600" />
                          Swap pending
                        </p>
                      )}
                      {!isFront && !pos.fulfilled && waitTimeData?.estimatedMinutesPerPerson != null && (
                        <p className="text-xs text-ink/40">
                          Est. wait: {formatWaitTime(waitTimeData.estimatedMinutesPerPerson * unservedAhead)}
                        </p>
                      )}
                    </div>
                  </div>

                  {!selectMode && (
                    <div className="flex items-center flex-wrap gap-2 sm:flex-shrink-0">
                      {isCurrentUser && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setShowLeaveConfirm(true)}
                          isLoading={loadingAction === "leave"}
                        >
                          Leave
                        </Button>
                      )}
                      {isCreator && isRestaurant && !isCurrentUser && !pos.fulfilled && (
                        <button
                          onClick={() => handleCall(pos.id)}
                          disabled={loadingAction === `call-${pos.id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[2.25rem] font-mono text-xs uppercase tracking-widest text-accent border border-rule hover:border-accent transition-colors disabled:opacity-50"
                          title={`Call this party of ${pos.partySize ?? 1}`}
                        >
                          {pos.calledAt || pos.user.id === nowServingUserId ? "Call again" : "Call"}
                        </button>
                      )}
                      {isCreator && !isCurrentUser && !pos.fulfilled && (
                        <button
                          onClick={() => setFulfillConfirm({ positionId: pos.id, name: pos.user.name || (isRestaurant ? "this party" : "this person") })}
                          disabled={loadingAction === `fulfill-${pos.id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[2.25rem] font-mono text-xs uppercase tracking-widest text-green-700 border border-rule hover:border-green-700 transition-colors disabled:opacity-50"
                          title={isRestaurant ? "Mark as seated" : "Mark as fulfilled"}
                        >
                          {loadingAction === `fulfill-${pos.id}` && (
                            <div className="w-3 h-3 border-2 border-green-700 border-t-transparent rounded-full animate-spin" />
                          )}
                          {isRestaurant ? "Seated" : "Fulfill"}
                        </button>
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
                  )}
                </div>

                {/* Incoming offers to the current user */}
                {isCurrentUser && receivedOffers.filter((o) => o.status === "PENDING").map((offer) => {
                  const offerer = positions.find((p) => p.user.id === offer.fromUserId)
                  return (
                    <div key={offer.id} className="mt-3 bg-paper border border-rule border-l-2 border-l-amber-600 p-3">
                      <p className="text-sm font-medium text-ink">
                        Swap offer: {formatCurrency(offer.amount)} from {offerer?.user.name || "someone behind you"}
                      </p>
                      <p className="text-xs text-ink/50 mt-0.5">
                        You&apos;d receive {formatCurrency(offer.amount)} and move back one spot.
                        {offer.expiresAt && ` Expires in ${formatTimeLeft(offer.expiresAt)}.`}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <Button
                          size="sm"
                          onClick={() => handleRespondToOffer(offer.id, "accept")}
                          isLoading={loadingAction === `offer-${offer.id}`}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRespondToOffer(offer.id, "decline")}
                          isLoading={loadingAction === `offer-${offer.id}`}
                        >
                          Decline
                        </Button>
                      </div>
                    </div>
                  )
                })}

                {/* Offers this user accepted that the buyer hasn't paid for yet */}
                {isCurrentUser && receivedOffers.filter((o) => o.status === "ACCEPTED" && o.awaitingPayment).map((offer) => {
                  const offerer = positions.find((p) => p.user.id === offer.fromUserId)
                  return (
                    <div key={offer.id} className="mt-3 bg-paper border border-rule border-l-2 border-l-amber-600 p-3">
                      <p className="text-sm text-ink">
                        You accepted {offerer?.user.name || "their"}&apos;s {formatCurrency(offer.amount)} offer -- waiting for them to pay.
                      </p>
                      <p className="text-xs text-ink/50 mt-0.5">
                        Both spots are held until they pay or the payment window closes. If they don&apos;t, the offer comes back to you.
                      </p>
                    </div>
                  )
                })}

                {/* List / re-price / un-list the current user's own position */}
                {isCurrentUser && allowResale && !isPaused && !selectMode && !offMarket(pos) && (
                  <div className="mt-3">
                    {isLocked ? (
                      <p className="text-sm text-ink/50">
                        Your position is locked while a swap is in progress.
                      </p>
                    ) : pos.askingPrice != null ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm text-ink/70">
                          Listed for{" "}
                          <span className="font-mono tabular-nums">{formatCurrency(pos.askingPrice)}</span>
                          {feeInfo && (
                            <span className="text-ink/40"> (buyer pays {formatCurrency(buyerTotal(pos.askingPrice))})</span>
                          )}
                        </p>
                        <button
                          onClick={() => handleSetPrice(null)}
                          disabled={priceLoading}
                          className="font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink underline underline-offset-4 disabled:opacity-50"
                        >
                          Remove from sale
                        </button>
                      </div>
                    ) : listPriceFormOpen ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative flex-1 sm:flex-none">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-ink/40">$</span>
                          <input
                            type="number"
                            min="1"
                            max={maxAskingPrice ?? undefined}
                            step="0.01"
                            placeholder="0.00"
                            aria-label="Asking price for your spot"
                            value={listPriceAmount}
                            onChange={(e) => setListPriceAmount(e.target.value)}
                            className={`w-full sm:w-28 pl-6 pr-2 py-1 border bg-white font-mono tabular-nums text-sm focus:outline-none focus:border-ink ${
                              maxAskingPrice != null && listPriceAmount && parseFloat(listPriceAmount) > maxAskingPrice
                                ? "border-accent"
                                : "border-rule"
                            }`}
                          />
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleSetPrice(parseFloat(listPriceAmount))}
                          isLoading={priceLoading}
                          disabled={maxAskingPrice != null && !!listPriceAmount && parseFloat(listPriceAmount) > maxAskingPrice}
                        >
                          List for Sale
                        </Button>
                        <button
                          onClick={() => { setListPriceFormOpen(false); setListPriceAmount("") }}
                          className="text-sm text-ink/50 hover:text-ink"
                        >
                          Cancel
                        </button>
                        {maxAskingPrice != null && (
                          <span className={`text-xs font-mono tabular-nums ${
                            listPriceAmount && parseFloat(listPriceAmount) > maxAskingPrice
                              ? "text-accent"
                              : "text-ink/40"
                          }`}>
                            Max: {formatCurrency(maxAskingPrice)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => setListPriceFormOpen(true)}
                        className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
                      >
                        List Your Spot For Sale
                      </button>
                    )}
                    {stripeEnabled && !hasPayoutSetup && (pos.askingPrice != null || listPriceFormOpen) && (
                      <div className="mt-2 flex items-center justify-between gap-3 bg-accent/5 border border-accent/30 px-3 py-2">
                        <p className="text-xs text-ink/70">
                          You haven&apos;t connected a payout account yet. If your spot sells, we hold your money until you connect one.
                        </p>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={handleConnectSetup}
                          isLoading={connectLoading}
                          className="flex-shrink-0"
                        >
                          Connect Now
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Offer to swap -- shown on the position directly in front */}
                {/* Shown even while the spot is locked: once the person in front
                    accepts, both spots lock, and the buyer still has to be able
                    to reach their payment link. */}
                {isDirectlyInFront && !isCurrentUser && allowResale && !isPaused && !selectMode &&
                  !offMarket(pos) && !(currentUserPosition && offMarket(currentUserPosition)) && (
                  <div className="mt-3 space-y-2">
                    {pos.askingPrice != null && !isLocked && (
                      <div>
                        <Button
                          size="sm"
                          onClick={() => setBuyConfirm({
                            positionId: pos.id,
                            sellerId: pos.user.id,
                            sellerName: pos.user.name,
                            position: pos.position,
                            askingPrice: pos.askingPrice!,
                          })}
                          isLoading={loadingAction === `buy-${pos.id}`}
                        >
                          Buy for {formatCurrency(buyerTotal(pos.askingPrice))}
                        </Button>
                      </div>
                    )}
                    {sentOfferToFront?.status === "ACCEPTED" && sentOfferToFront.awaitingPayment ? (
                      <div className="bg-paper border border-rule border-l-2 border-l-accent p-3">
                        <p className="text-sm font-medium text-ink">
                          {pos.user.name || "They"} accepted your {formatCurrency(sentOfferToFront.amount)} offer.
                        </p>
                        <p className="text-xs text-ink/50 mt-0.5">
                          Pay {formatCurrency(buyerTotal(sentOfferToFront.amount))} (incl. fees) to take their spot. Both spots are held for you for up to 30 minutes.
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <Button
                            size="sm"
                            onClick={() => handleCompletePayment(sentOfferToFront.id)}
                            isLoading={loadingAction === `pay-${sentOfferToFront.id}`}
                          >
                            Complete Payment
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleWithdrawOffer(sentOfferToFront.id)}
                            isLoading={loadingAction === `withdraw-${sentOfferToFront.id}`}
                          >
                            Back Out
                          </Button>
                        </div>
                      </div>
                    ) : isLocked ? null : sentOfferToFront?.status === "PENDING" ? (
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-sm text-ink/50">
                          Offer sent: {formatCurrency(sentOfferToFront.amount)} -- waiting for response
                          {sentOfferToFront.expiresAt && ` (expires in ${formatTimeLeft(sentOfferToFront.expiresAt)})`}
                        </p>
                        <button
                          onClick={() => handleWithdrawOffer(sentOfferToFront.id)}
                          disabled={loadingAction === `withdraw-${sentOfferToFront.id}`}
                          className="font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink underline underline-offset-4 disabled:opacity-50"
                        >
                          Withdraw
                        </button>
                      </div>
                    ) : sentOfferToFront && ["DECLINED", "EXPIRED", "WITHDRAWN"].includes(sentOfferToFront.status) && offerFormOpen !== pos.user.id ? (
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-sm text-ink/40">
                          {sentOfferToFront.status === "WITHDRAWN"
                            ? `You withdrew your ${formatCurrency(sentOfferToFront.amount)} offer.`
                            : `Your ${formatCurrency(sentOfferToFront.amount)} offer ${sentOfferToFront.status === "DECLINED" ? "was declined" : "expired"}.`}
                        </p>
                        <button
                          onClick={() => setOfferFormOpen(pos.user.id)}
                          className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
                        >
                          Make a New Offer
                        </button>
                      </div>
                    ) : offerFormOpen === pos.user.id ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative flex-1 sm:flex-none">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-ink/40">$</span>
                          <input
                            type="number"
                            min="1"
                            max={maxAskingPrice ?? undefined}
                            step="0.01"
                            placeholder="0.00"
                            aria-label="Your offer"
                            value={offerAmount}
                            onChange={(e) => setOfferAmount(e.target.value)}
                            className={`w-full sm:w-28 pl-6 pr-2 py-1 border bg-white font-mono tabular-nums text-sm focus:outline-none focus:border-ink ${
                              maxAskingPrice != null && offerAmount && parseFloat(offerAmount) > maxAskingPrice
                                ? "border-accent"
                                : "border-rule"
                            }`}
                          />
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleSendOffer(pos.user.id)}
                          isLoading={offerLoading}
                          disabled={maxAskingPrice != null && !!offerAmount && parseFloat(offerAmount) > maxAskingPrice}
                        >
                          Send Offer
                        </Button>
                        <button
                          onClick={() => { setOfferFormOpen(null); setOfferAmount("") }}
                          className="text-sm text-ink/50 hover:text-ink"
                        >
                          Cancel
                        </button>
                        {maxAskingPrice != null && (
                          <span className={`text-xs font-mono tabular-nums ${
                            offerAmount && parseFloat(offerAmount) > maxAskingPrice
                              ? "text-accent"
                              : "text-ink/40"
                          }`}>
                            Max: {formatCurrency(maxAskingPrice)}
                          </span>
                        )}
                        {parseFloat(offerAmount) >= 1 && (
                          <span className="w-full text-xs text-ink/50">
                            They receive {formatCurrency(parseFloat(offerAmount))}; you&apos;d pay {formatCurrency(buyerTotal(parseFloat(offerAmount)))} incl. fees if they accept.
                          </span>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => setOfferFormOpen(pos.user.id)}
                        className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
                      >
                        Offer to Swap
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          </div>
        </div>
      )}

      {/* Floating action bar for batch select mode */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-ink z-40 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-widest text-ink tabular-nums">
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

/** A short note for the host, saved when the field loses focus or on Enter. */
function NoteField({
  initial,
  label,
  saving,
  onSave,
}: {
  initial: string
  label: string
  saving: boolean
  onSave: (note: string) => void
}) {
  const [value, setValue] = useState(initial)
  const save = () => {
    if (value.trim() !== initial.trim()) onSave(value)
  }
  return (
    <input
      type="text"
      value={value}
      maxLength={140}
      placeholder="Add a note (high chair, patio...)"
      aria-label={label}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className="mt-1 w-full max-w-xs border border-rule bg-white px-2 py-1 text-xs text-ink placeholder:text-ink/30 focus:outline-none focus:border-ink disabled:opacity-50"
    />
  )
}
