"use client"

import Image from "next/image"
import { callDeadline, timeLeft } from "@/lib/call-deadline"
import { useDialog } from "@/lib/use-dialog"
import { Button } from "./ui/Button"
import { ConfirmModal } from "./ui/ConfirmModal"
import { useToast } from "./ui/Toast"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useSession } from "next-auth/react"
import { formatCurrency, formatWaited } from "@/lib/format"
import { calcFees } from "@/lib/fees"
import { batchRemove } from "@/lib/batch-remove-client"
import { OFFER_COOLDOWN_MS } from "@/lib/offers"
import { formatWaitTime } from "@/lib/wait-time"
import { MAX_PARTY_SIZE } from "@/lib/capacity"
import { useNotifications } from "@/hooks/useNotifications"
import { timeoutSignal } from "@/lib/timeout-signal"

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
  /** Extra minutes the host gave them to show up */
  graceMinutes?: number
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
  /** What checkout will charge, fees included, once accepted */
  chargeTotal?: number | null
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

const NO_CONNECTION = "No connection. That wasn't sent -- try again when you have signal."
// The request may have reached the server and only the reply was lost, so
// don't claim it wasn't sent: refresh and let the screen show what stuck
const NO_CONNECTION_MAYBE = "Connection dropped -- that may not have gone through. Check the line below before trying again."

function formatTimeLeft(iso: string): string {
  const minutes = Math.max(0, (new Date(iso).getTime() - Date.now()) / 60000)
  if (minutes <= 0) return "0 min"
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
  /** No-show only makes sense for someone called and not yet seated */
  canNoShow: boolean
  transactionInfo: TransactionInfo | null
  loading: boolean
  /** Walk-in, or nothing ever bought or sold: no money panel to show */
  noPayments?: boolean
  fulfilled?: boolean
  partySize?: number
  /** The call shown when the dialog opened, so a No-show can't act on a stale one */
  calledAt?: string | null
  graceMinutes?: number
  /** Their reply as shown when it opened: "on my way" since means they're coming */
  response?: "ON_MY_WAY" | "RUNNING_LATE" | null
}

interface FeeInfo {
  ownerFeePercent: number
  platformFeePercent: number
}

interface QueueDisplayProps {
  lineId: string
  positions: Position[]
  /** Guests the line still has room for, when it has a cap (null = no cap) */
  roomLeft?: number | null
  /** The line caps guests (even when the count is hidden from guests) */
  hasCapacityLimit?: boolean
  /** Awaited after host actions, so a button isn't re-enabled on stale data */
  onRefresh: () => void | Promise<void>
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

export function QueueDisplay({ lineId, positions, roomLeft = null, hasCapacityLimit = false, onRefresh, isCreator = false, feeInfo, isPaused = false, hasPayoutSetup = false, stripeEnabled = false, allowResale = true, maxAskingPrice = null, hideCapacity = false, nowServingUserId = null, isRestaurant = false, onLeft, responseWindowMinutes = null, emailEnabled = false }: QueueDisplayProps) {
  const { data: session } = useSession()
  const { addToast } = useToast()
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [removalModal, setRemovalModal] = useState<RemovalModal | null>(null)
  const removalDialogRef = useDialog(!!removalModal, () => setRemovalModal(null))
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  // Seating collects held payments and serving emails the person, and
  // neither can be undone, so the host confirms first.
  const [fulfillConfirm, setFulfillConfirm] = useState<{ positionId: string; name: string } | null>(null)
  // Calling a party again wipes their reply and any extra time they were given
  const [recallConfirm, setRecallConfirm] = useState<{ positionId: string; message: string } | null>(null)
  // Withdrawing starts a cooldown, and backing out of an accepted offer
  // counts toward the walk-away limit, so the buyer confirms first.
  const [withdrawConfirm, setWithdrawConfirm] = useState<{ offerId: string; accepted: boolean } | null>(null)
  // Accepting locks both spots and can't be taken back: ask first
  const [acceptConfirm, setAcceptConfirm] = useState<SwapOffer | null>(null)
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
        const data = await res.json().catch(() => ({}))
        setWaitTimeData(data)
      }
    } catch {
      // Silently fail
    }
  }, [lineId])

  // Incoming offers only show in the viewer's own row, which can be far down
  // a long line, so toast each new one. The first load just seeds the set.
  // Keyed by offer id, valued by the highest amount seen, so a raise reads
  // as a raise rather than a brand-new offer.
  const seenOfferAmounts = useRef<Map<string, number> | null>(null)
  // The buyer's sent offers can be accepted or declined while they're
  // scrolled elsewhere (and the accepted one has a payment clock), so toast
  // those changes too. The first load just seeds the map.
  const prevSentStatuses = useRef<Map<string, SwapOffer["status"]> | null>(null)
  // The seller hears when an accepted offer falls through, too
  const prevReceivedStatuses = useRef<Map<string, SwapOffer["status"]> | null>(null)
  const { sendNotification } = useNotifications()
  /** Offers expire and payment windows close: reach people in other tabs too */
  const offerAlert = useCallback((message: string, type: "info" | "success" | "warning") => {
    // Tagged by message, not just the line: someone both buying the spot ahead
    // and selling to the person behind kept only the last of two alerts
    sendNotification("Swap update", { body: message, tag: `waitlyst-${lineId}-offer-${message}` })
    if (document.visibilityState === "visible") addToast(message, type)
  }, [sendNotification, addToast, lineId])
  // Read by the offer watcher without re-creating it on every poll
  const positionsRef = useRef(positions)
  useEffect(() => {
    positionsRef.current = positions
  }, [positions])
  const maxPriceRef = useRef(maxAskingPrice)
  useEffect(() => {
    maxPriceRef.current = maxAskingPrice
  }, [maxAskingPrice])

  // On a slow link checks would overlap, and an older reply landing after a
  // newer one rewinds the statuses below and repeats an alert
  const offersInFlight = useRef(false)
  // Back from Stripe restores this page from the back/forward cache with the
  // Buy or Pay spinner still going: let them try again
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setLoadingAction(null) }
    window.addEventListener("pageshow", onShow)
    return () => window.removeEventListener("pageshow", onShow)
  }, [])

  const fetchOffers = useCallback(async () => {
    if (!session?.user?.id || offersInFlight.current) return
    offersInFlight.current = true
    try {
      const res = await fetch(`/api/lines/${lineId}/offer`, { signal: timeoutSignal(10_000) })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        setSentOffers(data.sent)
        setReceivedOffers(data.received)
        const pending = (data.received as SwapOffer[]).filter((o) => o.status === "PENDING")
        const seen = seenOfferAmounts.current
        if (seen) {
          for (const o of pending) {
            const prev = seen.get(o.id)
            if (prev === undefined) {
              offerAlert(`New swap offer: ${formatCurrency(o.amount)}. See your spot in the line below.`, "info")
            } else if (o.amount > prev) {
              offerAlert(`Offer raised to ${formatCurrency(o.amount)}. See your spot in the line below.`, "info")
            }
          }
        } else if (pending.length > 0) {
          // Opened from the offer email, or back later: the offer card sits
          // in their own row, which can be far down the list
          const best = Math.max(...pending.map((o) => o.amount))
          offerAlert(
            pending.length === 1
              ? `You have a ${formatCurrency(best)} swap offer waiting. See your spot in the line below.`
              : `You have ${pending.length} swap offers waiting (up to ${formatCurrency(best)}). See your spot in the line below.`,
            "info"
          )
        }
        // Only offers still pending: a re-sent offer after a decline reuses the
        // same row, and a stale amount made it silent (or "raised")
        const nextSeen = new Map<string, number>()
        for (const o of pending) nextSeen.set(o.id, Math.max(o.amount, seen?.get(o.id) ?? 0))
        seenOfferAmounts.current = nextSeen

        const sent = data.sent as SwapOffer[]
        const prevSent = prevSentStatuses.current
        if (prevSent) {
          for (const o of sent) {
            const was = prevSent.get(o.id)
            if (!was || was === o.status) continue
            const amount = formatCurrency(o.amount)
            if (was === "PENDING" && o.status === "ACCEPTED" && o.awaitingPayment) {
              // A hidden tab may hear about it late: give the time actually left
              const lockedUntil = positionsRef.current.find((p) => p.user.id === o.toUserId)?.lockedUntil
              const payWindow = lockedUntil && new Date(lockedUntil) > new Date() ? formatTimeLeft(lockedUntil) : "30 min"
              offerAlert(
                `Your ${amount} offer was accepted. Pay ${o.chargeTotal != null ? formatCurrency(o.chargeTotal) : "it"} (incl. fees) within ${payWindow} to take their spot.`,
                "success"
              )
            } else if (o.status === "DECLINED") {
              offerAlert(`Your ${amount} offer was declined.`, "info")
            } else if (o.status === "EXPIRED") {
              // Expired offers used to just vanish when the person ahead changed
              offerAlert(
                was === "ACCEPTED"
                  ? `Your ${amount} swap was called off -- it wasn't paid in time or couldn't go through. You weren't charged.`
                  : maxPriceRef.current != null && o.amount > maxPriceRef.current
                    ? `Your ${amount} offer was called off -- the organizer lowered the max price to ${formatCurrency(maxPriceRef.current)}. You can send a new one within it right away.`
                    : `Your ${amount} offer expired -- the spot ahead of you changed or no one answered in time.`,
                "info"
              )
            } else if (was === "ACCEPTED" && o.status === "PENDING") {
              offerAlert(`The payment window for your ${amount} offer closed. You weren't charged.`, "info")
            }
            // ACCEPTED -> EXPIRED (window lapsed) is covered by the EXPIRED case
          }
        }
        prevSentStatuses.current = new Map(sent.map((o) => [o.id, o.status]))

        const received = data.received as SwapOffer[]
        const prevReceived = prevReceivedStatuses.current
        if (prevReceived) {
          for (const o of received) {
            // An offer that vanished before they answered it: say why, so the
            // card going away isn't a mystery (or an Accept that then fails)
            if (prevReceived.get(o.id) === "PENDING") {
              if (o.status === "WITHDRAWN") {
                offerAlert(`They withdrew their ${formatCurrency(o.amount)} offer for your spot.`, "info")
              } else if (o.status === "EXPIRED") {
                offerAlert(`The ${formatCurrency(o.amount)} offer for your spot expired or no longer applies.`, "info")
              }
              continue
            }
            if (prevReceived.get(o.id) !== "ACCEPTED") continue
            if (o.status === "PENDING" || o.status === "EXPIRED") {
              // Lapsed payment, a call, or an organizer cancel all land here: say
              // what happened without blaming the buyer for a reason we can't see
              offerAlert(`The ${formatCurrency(o.amount)} swap didn't go through, so it's off. You keep your spot.`, "info")
            } else if (o.status === "WITHDRAWN") {
              offerAlert(`They backed out of the ${formatCurrency(o.amount)} swap. You keep your spot.`, "info")
            }
          }
        }
        prevReceivedStatuses.current = new Map(received.map((o) => [o.id, o.status]))
      }
    } catch {
      // Silently fail
    } finally {
      offersInFlight.current = false
    }
  }, [lineId, session?.user?.id, offerAlert])

  // Seated parties stay listed until cleared, so seating doesn't change the
  // length: watch the served count too or the estimate never catches up
  const servedCount = positions.filter((p) => p.fulfilled).length
  useEffect(() => {
    fetchWaitTime()
  }, [fetchWaitTime, positions.length, servedCount])

  useEffect(() => {
    fetchOffers()
  }, [fetchOffers, positions.length])

  // Poll for offer status changes (e.g. the person in front accepting your
  // offer) even when nothing else on the page has changed.
  // Only people in the line can send or receive offers, and a hidden tab
  // doesn't need them (each poll scans the line's positions).
  const viewerInLine = !!session?.user?.id && positions.some((p) => p.user.id === session.user.id)
  useEffect(() => {
    // With swaps off there are no offers to hear about: polling would just
    // double every guest's traffic (and share-IP rate limit) for nothing
    if (!viewerInLine || !allowResale) return
    const interval = setInterval(() => {
      // With notifications on, a hidden tab still checks: an offer or a
      // 30-minute payment window shouldn't wait for them to come back
      const notifying = "Notification" in window && Notification.permission === "granted"
      if (document.visibilityState === "visible" || notifying) fetchOffers()
    }, 10000)
    return () => clearInterval(interval)
  }, [fetchOffers, viewerInLine, allowResale])

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

  // Lowering the line's max takes down listings above it (settings route);
  // the reseller's "Listed for $X" used to just vanish without a word
  const myAsk = currentUserPosition?.askingPrice ?? null
  const prevAsk = useRef(myAsk)
  useEffect(() => {
    const was = prevAsk.current
    prevAsk.current = myAsk
    if (was != null && myAsk == null && maxAskingPrice != null && was > maxAskingPrice) {
      addToast(
        `The organizer lowered the max price to ${formatCurrency(maxAskingPrice)}, so your ${formatCurrency(was)} listing was taken down. You can list again at or under the new max.`,
        "info"
      )
    }
  }, [myAsk, maxAskingPrice, addToast])

  // A buy they started but never finished (closed the Stripe tab, pressed
  // Back) keeps both spots locked; let them pick it up again or call it off.
  const [myCheckout, setMyCheckout] = useState<{ pending: boolean; url: string | null; paid?: boolean; released?: boolean } | null>(null)
  // Cancelling counts toward the walk-away limit, so it's confirmed like Back Out
  const [cancelCheckoutConfirm, setCancelCheckoutConfirm] = useState(false)
  const myLockUntil = currentUserPosition?.lockedUntil ?? null
  const myPlace = currentUserPosition?.position ?? null
  // The number their row shows: restaurant rows count waiting parties only,
  // so a toast quoting the raw spot number contradicted the list and the email
  const myDisplayPlace = currentUserPosition
    ? isRestaurant
      ? positions.filter((p) => p.position < currentUserPosition.position && !p.fulfilled).length + 1
      : currentUserPosition.position
    : null
  // When their own pending buy's payment window ends, to tell a lapse from a
  // swap someone else called off
  const pendingBuyUntil = useRef<string | null>(null)
  // Where they stood while their direct buy was pending, to tell them how it
  // ended when the lock clears (the "Resume payment" card used to just vanish)
  const pendingBuyFrom = useRef<number | null>(null)
  // Where they stood while someone else was paying for their spot: a sale
  // used to show nothing on screen -- the spot just moved back
  const sellingFrom = useRef<number | null>(null)
  useEffect(() => {
    if (!myLockUntil || new Date(myLockUntil) <= new Date()) {
      const was = pendingBuyFrom.current
      pendingBuyFrom.current = null
      const buyUntil = pendingBuyUntil.current
      pendingBuyUntil.current = null
      const sold = sellingFrom.current
      sellingFrom.current = null
      // A swap that fell through is already announced by the offer watcher
      if (sold !== null && myPlace !== null && myPlace > sold) {
        addToast(`Your spot sold -- you're now #${myDisplayPlace}. Your earnings are on your profile.`, "success")
      }
      if (was !== null && myPlace !== null) {
        if (myPlace < was) {
          addToast(`Your payment went through -- you're now #${myDisplayPlace}.`, "success")
        } else if (buyUntil && Date.now() >= new Date(buyUntil).getTime() - 2 * 60_000) {
          // Stripe ends the checkout a minute before the lock; it ran out on them
          addToast(
            "Your payment window for the spot ahead closed, so the purchase is off. You weren't charged. Letting several lapse pauses buying here for a while.",
            "info"
          )
        } else {
          addToast(
            "Your purchase of the spot ahead was called off (they were called up, left, or the organizer stopped it). You weren't charged.",
            "info"
          )
        }
      }
      setMyCheckout(null)
      return
    }
    let cancelled = false
    fetch(`/api/lines/${lineId}/my-checkout`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        setMyCheckout(data)
        // The payment had gone through; the server just finished the swap
        if (data?.paid) {
          addToast(
            isRestaurant
              ? "Your payment went through -- the spot is yours. Your card is held until you're seated."
              : "Your payment went through -- the spot is yours.",
            "success"
          )
          onRefresh()
        } else if (data?.released) {
          addToast(
            "The spot you were buying changed hands before the swap could finish, so it was cancelled. The hold on your card has been released.",
            "info"
          )
          onRefresh()
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // myPlace is read only when the lock clears, which changes myLockUntil
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId, myLockUntil, addToast, onRefresh, isRestaurant])
  useEffect(() => {
    // Only their own pending buy (not someone paying for their spot); cancelling
    // clears myCheckout first, so a deliberate cancel isn't reported
    pendingBuyFrom.current = myCheckout?.pending ? myPlace : null
    pendingBuyUntil.current = myCheckout?.pending ? myLockUntil : null
    // { pending: false } while locked: someone else is buying this spot
    sellingFrom.current = myCheckout && !myCheckout.pending && !myCheckout.paid ? myPlace : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCheckout])

  /** A mutation's reply never arrived (Wi-Fi to cellular, a 502 page...) */
  function lostConnection() {
    addToast(NO_CONNECTION_MAYBE, "error")
    fetchOffers()
    onRefresh()
  }

  async function handleGiveMoreTime(positionId: string, name?: string | null) {
    setLoadingAction(`grace-${positionId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/grace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) addToast(`Gave ${name || "them"} 5 more minutes${data.graceMinutes > 5 ? ` (${data.graceMinutes} extra in all)` : ""}`, "success")
      else addToast(data.error || "Couldn't give more time", "error")
      await onRefresh()
    } catch {
      lostConnection()
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleCancelMyCheckout() {
    setLoadingAction("cancel-checkout")
    try {
      const res = await fetch(`/api/lines/${lineId}/my-checkout`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        addToast("Purchase cancelled. No charges were made.", "info")
        setMyCheckout(null)
      } else {
        addToast(data.error || "Couldn't cancel the purchase", "error")
      }
      onRefresh()
    } catch {
      lostConnection()
    } finally {
      setLoadingAction(null)
    }
  }

  // Called-up and served spots are off the market (the server enforces it too).
  const offMarket = (p: Position) => !!p.fulfilled || !!p.calledAt || p.user.id === nowServingUserId

  // Find the sent offer for the person directly in front
  const sentOfferToFront = positionInFront
    ? sentOffers.find((o) => o.toUserId === positionInFront.user.id)
    : null
  // The person ahead accepted our offer and both spots are held while we pay.
  const payingForOffer = sentOfferToFront?.status === "ACCEPTED" && !!sentOfferToFront.awaitingPayment
  // Our own spot is held for a swap in progress, so we can't start another buy.
  const myLockActive = !!myLockUntil && new Date(myLockUntil) > new Date()

  // The only word about the 30-minute payment window used to come after it
  // closed. Warn at 5 minutes and at 1 (once each per offer) while there's
  // still time to finish paying.
  const paymentWarned = useRef(new Set<string>())
  const paymentDeadline = payingForOffer ? positionInFront?.lockedUntil ?? null : null
  const payingOfferId = payingForOffer ? sentOfferToFront?.id ?? null : null
  useEffect(() => {
    if (!paymentDeadline || !payingOfferId) return
    const check = () => {
      const msLeft = new Date(paymentDeadline).getTime() - Date.now()
      for (const [mark, label] of [[60_000, "1 minute"], [5 * 60_000, "5 minutes"]] as const) {
        const key = `${payingOfferId}:${mark}`
        if (msLeft > 0 && msLeft <= mark && !paymentWarned.current.has(key)) {
          // Hitting the 1-minute mark also covers the 5-minute one
          paymentWarned.current.add(`${payingOfferId}:${5 * 60_000}`).add(key)
          offerAlert(`About ${label} left to pay for your swap. Use Complete Payment to finish it.`, "warning")
          break
        }
      }
    }
    check()
    const id = setInterval(check, 15_000)
    return () => clearInterval(id)
  }, [paymentDeadline, payingOfferId, offerAlert])

  async function handleSendOffer(toUserId: string) {
    // The server rounds to cents; "10.004" must not look like a raise on $10
    const amount = Math.round(parseFloat(offerAmount) * 100) / 100
    if (!amount || amount < 1) {
      addToast("Offers must be at least $1.00", "error")
      return
    }
    if (maxAskingPrice != null && amount > maxAskingPrice) {
      addToast(`Amount exceeds max price of ${formatCurrency(maxAskingPrice)}`, "error")
      return
    }
    if (sentOfferToFront?.status === "PENDING" && amount <= sentOfferToFront.amount) {
      addToast(`Raise above your current ${formatCurrency(sentOfferToFront.amount)}`, "error")
      return
    }

    setOfferLoading(true)
    try {
      const res = await fetch(`/api/lines/${lineId}/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId, amount }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        addToast(sentOfferToFront?.status === "PENDING" ? "Offer raised" : "Offer sent", "success")
        setOfferFormOpen(null)
        setOfferAmount("")
        fetchOffers()
      } else {
        addToast(data.error || "Failed to send offer", "error")
        // They answered, or a payment is waiting: show the offer as it is now
        if (res.status === 409) fetchOffers()
      }
    } catch {
      lostConnection()
    } finally {
      setOfferLoading(false)
    }
  }

  async function handleRespondToOffer(offer: SwapOffer, action: "accept" | "decline") {
    const offerId = offer.id
    setLoadingAction(`offer-${offerId}-${action}`)
    try {
      // The amount they saw, so a raise landing just before the click is
      // rejected rather than accepted or declined sight unseen.
      const res = await fetch(`/api/lines/${lineId}/offer/${offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedAmount: offer.amount }),
      })
      const data = await res.json().catch(() => ({}))
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
        // Raised, withdrawn, expired or already answered: show what it is now
        fetchOffers()
      }
    } catch {
      lostConnection()
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
    let redirecting = false
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
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        if (data.url) {
          // Stay busy while Stripe loads: a second tap only hits "already locked"
          redirecting = true
          window.location.href = data.url
          return
        }
        addToast("Position purchased!", "success")
        onRefresh()
      } else {
        addToast(data.error || "Failed to buy position", "error")
        if (res.status === 409) onRefresh()
      }
    } catch {
      lostConnection()
    } finally {
      if (!redirecting) setLoadingAction(null)
    }
  }

  /** Withdraw a pending offer, or back out of one that was accepted but not yet paid. */
  async function handleWithdrawOffer(offerId: string, accepted = false) {
    setLoadingAction(`withdraw-${offerId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/offer/${offerId}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        addToast(accepted ? "You backed out. Both spots are released and you weren't charged." : "Offer withdrawn", "info")
        fetchOffers()
        onRefresh()
      } else {
        addToast(data.error || "Failed to withdraw offer", "error")
        // They may have just answered it, or the payment already moved them
        fetchOffers()
        onRefresh()
      }
    } catch {
      lostConnection()
    } finally {
      setLoadingAction(null)
    }
  }

  /** Once the person in front has accepted your offer, fetch the payment link that's actually yours to use. */
  async function handleCompletePayment(offerId: string) {
    let redirecting = false
    setLoadingAction(`pay-${offerId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/offer/${offerId}/checkout`)
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.checkoutUrl) {
        redirecting = true
        window.location.href = data.checkoutUrl
        return
      }
      if (res.ok && data.paid) {
        // Paid in another tab, or the return page never loaded
        addToast(data.message || "Your payment already went through.", "success")
      } else {
        addToast(data.error || "Could not start payment", "error")
      }
      // Paid, window closed, or the swap fell through: the card above is stale
      fetchOffers()
      onRefresh()
    } catch {
      lostConnection()
    } finally {
      if (!redirecting) setLoadingAction(null)
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
      const data = await res.json().catch(() => ({}))
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
      const data = await res.json().catch(() => ({}))
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
        // Called up, or a swap with them started: the listing controls are stale
        if (res.status === 409 || res.status === 400) onRefresh()
      }
    } catch {
      lostConnection()
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
        // Their row (and the Leave button focus sat on) is about to vanish:
        // park focus on the list so keyboard and screen readers keep their place
        void Promise.resolve(onRefresh()).then(focusListSoon)
      } else {
        const data = await res.json().catch(() => ({}))
        // A retry after a dropped reply (the first tap did go through), or
        // they'd already been removed: either way they're out, not stuck
        if (res.status === 400 && data.error === "You are not in this line") {
          onLeft?.()
          addToast("You're no longer in this line", "info")
          void Promise.resolve(onRefresh()).then(focusListSoon)
          return
        }
        addToast(data.error || "Couldn't leave the line. Please try again.", "error")
        onRefresh()
      }
    } catch {
      // A dropped connection used to fail silently, leaving them unsure
      // whether they were still holding a table. The leave may have landed
      // with only the reply lost: mark it as theirs so the next poll doesn't
      // report "removed by the host" (a poll still showing them clears it)
      onLeft?.()
      addToast(NO_CONNECTION_MAYBE, "error")
      onRefresh()
    } finally {
      setLoadingAction(null)
    }
  }

  async function openRemovalModal(
    positionId: string,
    userId: string,
    userName: string | null,
    canNoShow: boolean,
    opts: { isWalkIn?: boolean; partySize?: number; fulfilled?: boolean; calledAt?: string | null; graceMinutes?: number; response?: RemovalModal["response"] } = {}
  ) {
    // A walk-in has no account to have paid with: skip the spinner and the
    // "$0.00 (0 purchases)" panel, which only reads as a money problem
    const skipFetch = !!opts.isWalkIn
    setRemovalModal({
      positionId,
      userId,
      userName,
      canNoShow,
      transactionInfo: null,
      loading: !skipFetch,
      noPayments: skipFetch,
      partySize: opts.partySize,
      fulfilled: opts.fulfilled,
      calledAt: opts.calledAt,
      graceMinutes: opts.graceMinutes,
      response: opts.response ?? null,
    })
    if (skipFetch) return

    try {
      const res = await fetch(`/api/lines/${lineId}/position-transactions?userId=${userId}`)
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        const none =
          Array.isArray(data.asBuyer) && data.asBuyer.length === 0 &&
          Array.isArray(data.asSeller) && data.asSeller.length === 0 &&
          !(data.downstreamBuyers?.length > 0)
        setRemovalModal(prev => prev ? { ...prev, transactionInfo: data, loading: false, noPayments: none } : null)
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
          ...(noShow && {
            noShow: true,
            calledAt: removalModal.calledAt ?? undefined,
            graceMinutes: removalModal.graceMinutes ?? 0,
            response: removalModal.response ?? null,
          }),
        }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
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
          addToast(noShow ? "Marked as a no-show and removed" : isRestaurant ? "Party removed from the line" : "Person removed from line", "success")
        }
        setRemovalModal(null)
        focusListSoon()
        await onRefresh()
      } else {
        const data = await res.json().catch(() => ({}))
        addToast(data.error || (isRestaurant ? "Couldn't remove the party" : "Failed to remove person"), "error")
        // Usually another device (or the guest) got there first: close the
        // dialog on the stale row and show what really happened
        if (res.status === 404 || res.status === 409) {
          setRemovalModal(null)
          focusListSoon()
          await onRefresh()
        }
      }
    } catch {
      addToast(NO_CONNECTION, "error")
    } finally {
      setLoadingAction(null)
    }
  }

  /**
   * After a removal the dialog hands focus back to the row's Remove button,
   * which the refresh then deletes, dropping keyboard users to the top of the
   * page. Park focus on the list itself once the dialog has closed.
   */
  function focusListSoon() {
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-dialog-fallback]")?.focus())
  }

  /** recall: the host knowingly calls someone already called ("Call again") */
  async function handleCall(positionId: string, recall = false) {
    setLoadingAction(`call-${positionId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/call-next`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId, ...(recall && { recall: true }) }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        addToast(
          data.isWalkIn
            ? `${data.calledUser} is a walk-in — call them out at the stand`
            : `Called ${data.calledUser} (party of ${data.partySize})`,
          "success"
        )
        await onRefresh()
      } else {
        addToast(data.error || "Failed to call this party", "error")
        // Usually another device acted, or the party left: show what really
        // happened instead of leaving a Call button that only errors again
        if (res.status === 409 || res.status === 404 || res.status === 400) await onRefresh()
      }
    } catch {
      addToast(NO_CONNECTION, "error")
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
        await onRefresh()
      } else {
        const data = await res.json().catch(() => ({}))
        addToast(data.error || (positionId ? "Failed to update the party size" : "Failed to update your party size"), "error")
        // Refused because they were called, seated or removed meanwhile: show it
        if (res.status === 400 || res.status === 404) await onRefresh()
      }
    } catch {
      addToast(NO_CONNECTION, "error")
    } finally {
      setLoadingAction(null)
    }
  }

  /** Resolves whether it saved, so the field can let the same text be retried */
  async function handleNote(note: string, positionId?: string): Promise<boolean> {
    setLoadingAction(positionId ? `note-${positionId}` : "note")
    try {
      const res = await fetch(`/api/lines/${lineId}/party`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(positionId ? { note, positionId } : { note }),
      })
      if (res.ok) {
        addToast(note.trim() ? "Note saved" : "Note removed", "success")
        await onRefresh()
        return true
      } else {
        const data = await res.json().catch(() => ({}))
        addToast(data.error || "Failed to save the note", "error")
        if (res.status === 400 || res.status === 404) await onRefresh()
        return false
      }
    } catch {
      addToast(NO_CONNECTION, "error")
      return false
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
        await onRefresh()
      } else {
        const data = await res.json().catch(() => ({}))
        addToast(data.error || "Failed to save the quote", "error")
      }
    } catch {
      addToast(NO_CONNECTION, "error")
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleFulfill(positionId: string, name?: string) {
    setLoadingAction(`fulfill-${positionId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/fulfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        const n = data.payoutsReleased ?? 0
        const payoutMsg = n > 0
          ? isRestaurant
            ? ` (${n} held payment${n === 1 ? "" : "s"} collected)`
            // Collected, not necessarily paid out: a payee with no payout
            // account has their share held
            : ` (${n} payment${n === 1 ? "" : "s"} collected)`
          : ""
        const who = name && !name.startsWith("this ") ? name : isRestaurant ? "Party" : "Person"
        addToast(`${who} ${isRestaurant ? "seated" : "marked as served"}${payoutMsg}`, "success")
        if (data.payoutsFailed > 0) {
          addToast(
            `${data.payoutsFailed} payment${data.payoutsFailed === 1 ? "" : "s"} couldn't be collected -- review on the settlement page.`,
            "error"
          )
        }
        await onRefresh()
      } else {
        const data = await res.json().catch(() => ({}))
        addToast(data.error || `Failed to mark as ${isRestaurant ? "seated" : "served"}`, "error")
        // Another host device may have just seated them: show the real state
        await onRefresh()
      }
    } catch {
      addToast(NO_CONNECTION, "error")
    } finally {
      setLoadingAction(null)
    }
  }

  // Another device (or the guest) can remove a selected party mid-selection:
  // drop it so "N selected" and the batch count match what's on screen
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev
      const live = new Set(positions.map((p) => p.id))
      const next = new Set([...prev].filter((id) => live.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [positions])

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

  // Waiting parties ahead of each row, counted once per list instead of per
  // row (a full scan per row crawled on a 300-person drop). Positions arrive
  // sorted by place.
  const unservedAheadById = useMemo(() => {
    const m = new Map<string, number>()
    let n = 0
    for (const p of [...positions].sort((a, b) => a.position - b.position)) {
      m.set(p.id, n)
      if (!p.fulfilled) n++
    }
    return m
  }, [positions])
  // Finding "Garcia" among 80 parties meant scrolling; hosts can filter by name
  const [nameFilter, setNameFilter] = useState("")
  const showNameFilter = isCreator && positions.length > 20 && !selectMode
  const filterText = showNameFilter ? nameFilter.trim().toLowerCase() : ""
  const visiblePositions = filterText
    ? positions.filter((p) => (p.user.name || "").toLowerCase().includes(filterText) || (p.note || "").toLowerCase().includes(filterText))
    : positions

  function cancelSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  async function handleBatchRemove(action: "payout" | "refund") {
    setShowBatchConfirm(false)
    setBatchLoading(true)
    try {
      const { ok, data } = await batchRemove(lineId, Array.from(selectedIds), { action })
      if (ok) {
        // Parties another device (or the guest) already took off aren't failures
        const gone: number = data.alreadyGone ?? 0
        let msg = data.failed > 0
          ? `Removed ${data.removed}, ${data.failed} failed.`
          : data.removed === 0 && gone > 0
          ? gone === 1 ? "They had already left the line." : `All ${gone} had already left the line.`
          : `Removed ${data.removed} ${isRestaurant ? (data.removed === 1 ? "party" : "parties") : (data.removed === 1 ? "person" : "people")} from line.`
        if (gone > 0 && data.removed > 0) msg += ` ${gone} had already left.`
        if (data.refundedCount > 0) msg += ` Refunded ${formatCurrency(data.refundedAmount)}.`
        const moneyProblems = (data.refundFailedCount ?? 0) + (data.collectFailedCount ?? 0)
        if (moneyProblems > 0) msg += ` ${moneyProblems} payment(s) need attention on the settlement page.`
        addToast(msg, data.failed > 0 || moneyProblems > 0 ? "info" : "success")
        cancelSelectMode()
        focusListSoon()
        // Awaited so removed rows don't linger, still tappable, until a poll
        await onRefresh()
      } else {
        addToast(data.error || "Batch remove failed", "error")
      }
    } catch {
      addToast(NO_CONNECTION, "error")
    } finally {
      setBatchLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Removal Modal */}
      {removalModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div ref={removalDialogRef} className="bg-white border border-ink p-6 max-w-md w-full mx-4" role="dialog" aria-modal="true" aria-labelledby="remove-title" aria-describedby="remove-desc">
            <h3 id="remove-title" className="text-lg font-semibold tracking-tight text-ink mb-4">
              Remove {removalModal.userName || (isRestaurant ? "this party" : "this person")}?
            </h3>

            <div id="remove-desc">
            {removalModal.loading ? (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ink mx-auto"></div>
                <p className="text-sm text-ink/60 mt-2">Loading transaction history...</p>
              </div>
            ) : removalModal.noPayments ? (
              <p className="text-sm text-ink/60 mb-4">
                {removalModal.fulfilled
                  ? isRestaurant
                    ? "Takes them off the list. Their table isn't affected."
                    : "Takes them off the list. They've already been served."
                  : <>
                      {isRestaurant && removalModal.partySize
                        ? `They're a party of ${removalModal.partySize}. `
                        : ""}
                      Everyone behind them moves up.
                    </>}
              </p>
            ) : removalModal.transactionInfo ? (
              <div className="space-y-3 mb-4">
                <div className="bg-paper border border-rule p-3">
                  <p className="text-sm text-ink/60">
                    <span className="font-medium text-ink">Paid:</span> <span className="font-mono tabular-nums">{formatCurrency(removalModal.transactionInfo.totalPaid)}</span>
                    <span className="text-ink/60 ml-1">({(() => {
                      const n = removalModal.transactionInfo.asBuyer.filter((t) => t.status === "COMPLETED").length
                      return `${n} purchase${n === 1 ? "" : "s"}, incl. fees`
                    })()})</span>
                  </p>
                  <p className="text-sm text-ink/60">
                    <span className="font-medium text-ink">Received:</span> <span className="font-mono tabular-nums">{formatCurrency(removalModal.transactionInfo.totalReceived)}</span>
                    <span className="text-ink/60 ml-1">({(() => {
                      const n = removalModal.transactionInfo.asSeller.filter((t) => t.status === "COMPLETED").length
                      return `${n} sale${n === 1 ? "" : "s"}`
                    })()})</span>
                  </p>
                  {/* Two different kinds of money: what went back to this person, and
                      their own sales that went back to other buyers (never theirs).
                      Released card holds count too -- they were never charged. */}
                  {removalModal.transactionInfo.totalRefundedToBuyer > 0 && (
                    <p className="text-sm text-amber-700">
                      <span className="font-medium">Refunded or released to them:</span> {formatCurrency(removalModal.transactionInfo.totalRefundedToBuyer)}
                    </p>
                  )}
                  {removalModal.transactionInfo.totalRefundedAsSeller > 0 && (
                    <p className="text-sm text-amber-700">
                      <span className="font-medium">Their sales reversed:</span> {formatCurrency(removalModal.transactionInfo.totalRefundedAsSeller)}
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
                    <p className="text-xs text-amber-700 mt-2">
                      These buyers keep the places they bought; removing this person doesn&apos;t change that.
                      {isRestaurant
                        ? " To refund one of them, remove that buyer and choose the refund option."
                        : " Their purchases are final and were already collected."}
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

            </div>

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
              {/* Recorded separately from other removals; purchases are kept.
                  Only for someone called and not seated: anyone else isn't
                  a no-show, and it would skew the no-show rate. */}
              {removalModal.canNoShow && (
                <Button
                  variant="secondary"
                  onClick={() => handleRemoveWithAction("payout", true)}
                  isLoading={loadingAction === `remove-${removalModal.positionId}`}
                  disabled={removalModal.loading}
                  className="w-full"
                >
                  No-show{removalModal.transactionInfo && removalModal.transactionInfo.refundableCount > 0 ? " (keep purchase)" : ""}
                </Button>
              )}
              {/* Starts here, not on Remove: a repeated Enter shouldn't remove them */}
              <Button
                variant="ghost"
                onClick={() => setRemovalModal(null)}
                className="w-full"
                data-autofocus
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
            <div ref={buyDialogRef} className="bg-white border border-ink p-6 max-w-sm w-full mx-4" role="dialog" aria-modal="true" aria-labelledby="buy-confirm-title" aria-describedby="buy-confirm-desc buy-confirm-total">
              <h3 id="buy-confirm-title" className="text-lg font-semibold tracking-tight text-ink mb-2">
                {isRestaurant ? "Buy the spot ahead of you?" : `Buy spot #${buyConfirm.position}?`}
              </h3>
              <p id="buy-confirm-desc" className="text-sm text-ink/60 mb-4">
                You&apos;ll swap places with {buyConfirm.sellerName || "the person in front of you"}.
                {stripeEnabled && (isRestaurant
                  ? " Your card is held, not charged, until you're seated. It's charged when you're seated or if you leave; the host can release it if you aren't seated."
                  : " This purchase is final: you're charged now, even if you leave or are removed later.")}
              </p>
              <dl id="buy-confirm-total" className="text-sm border border-rule divide-y divide-rule mb-4">
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
                    <dt className="text-ink/60">Waitlyst fee</dt>
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
            ? `Seat ${fulfillConfirm.name}?${allowResale ? " Any swap payment of theirs on hold is collected now." : ""} This can't be undone.`
            : `Mark ${fulfillConfirm.name} as served?${emailEnabled ? ` They'll get a "you've been served" email.` : ""}${
                // Phones never show the button's hover title: say it here
                (() => {
                  const lockedUntil = positions.find((p) => p.id === fulfillConfirm.positionId)?.lockedUntil
                  return lockedUntil && new Date(lockedUntil) > new Date()
                    ? " Someone is paying for a swap with this spot right now -- serving them cancels it (the buyer isn't charged)."
                    : ""
                })()
              } This can't be undone.`
          : ""}
        confirmLabel={isRestaurant ? "Seated" : "Served"}
        // Can't be undone: a reflexive Enter shouldn't seat anyone
        initialFocus="cancel"
        isLoading={!!fulfillConfirm && loadingAction === `fulfill-${fulfillConfirm.positionId}`}
        onConfirm={async () => {
          if (!fulfillConfirm) return
          await handleFulfill(fulfillConfirm.positionId, fulfillConfirm.name)
          setFulfillConfirm(null)
        }}
        onCancel={() => setFulfillConfirm(null)}
      />

      {/* Call-again confirmation */}
      <ConfirmModal
        open={!!recallConfirm}
        title="Call again"
        message={recallConfirm?.message ?? ""}
        confirmLabel="Call again"
        isLoading={!!recallConfirm && loadingAction === `call-${recallConfirm.positionId}`}
        onConfirm={async () => {
          if (!recallConfirm) return
          await handleCall(recallConfirm.positionId, true)
          setRecallConfirm(null)
        }}
        onCancel={() => setRecallConfirm(null)}
      />

      <ConfirmModal
        open={cancelCheckoutConfirm}
        title="Cancel this purchase?"
        message="Both spots are released and you won't be charged. It counts as a cancelled payment -- several of those and you can't buy or make offers here for a while."
        confirmLabel="Cancel Purchase"
        cancelLabel="Keep It"
        variant="danger"
        isLoading={loadingAction === "cancel-checkout"}
        onConfirm={async () => {
          await handleCancelMyCheckout()
          setCancelCheckoutConfirm(false)
        }}
        onCancel={() => setCancelCheckoutConfirm(false)}
      />

      {/* Accept-offer confirmation */}
      <ConfirmModal
        open={!!acceptConfirm}
        title="Accept this swap offer?"
        message={acceptConfirm
          ? `You'll move back one spot once they pay ${formatCurrency(acceptConfirm.amount)}${isRestaurant ? ", and you're paid when they're seated" : ""}. Both spots are held for up to 30 minutes while they pay, and you can't cancel once you accept.`
          : ""}
        confirmLabel="Accept"
        initialFocus="cancel"
        isLoading={!!acceptConfirm && loadingAction === `offer-${acceptConfirm.id}-accept`}
        onConfirm={async () => {
          if (!acceptConfirm) return
          await handleRespondToOffer(acceptConfirm, "accept")
          setAcceptConfirm(null)
        }}
        onCancel={() => setAcceptConfirm(null)}
      />

      {/* Withdraw / back-out confirmation */}
      <ConfirmModal
        open={!!withdrawConfirm}
        title={withdrawConfirm?.accepted ? "Back out of this swap?" : "Withdraw your offer?"}
        message={withdrawConfirm?.accepted
          ? `They already accepted, so backing out releases both spots and counts as a cancelled payment -- several of those and you can't buy or make offers here for a while. You won't be able to send them another offer for ${Math.round(OFFER_COOLDOWN_MS / 60_000)} minutes. You won't be charged.`
          : `You won't be able to send them another offer for ${Math.round(OFFER_COOLDOWN_MS / 60_000)} minutes.`}
        confirmLabel={withdrawConfirm?.accepted ? "Back Out" : "Withdraw"}
        variant="danger"
        isLoading={!!withdrawConfirm && loadingAction === `withdraw-${withdrawConfirm.offerId}`}
        onConfirm={async () => {
          if (!withdrawConfirm) return
          await handleWithdrawOffer(withdrawConfirm.offerId, withdrawConfirm.accepted)
          setWithdrawConfirm(null)
        }}
        onCancel={() => setWithdrawConfirm(null)}
      />

      {/* Leave Confirmation */}
      <ConfirmModal
        open={showLeaveConfirm}
        title="Leave Line"
        message={currentUserPosition?.fulfilled
          // Someone already at their table (or served) tidying up their list
          ? isRestaurant
            ? "You've been seated. This just takes the line off your list -- it doesn't affect your table."
            : "You've been served. This just takes the line off your list."
          : (!allowResale
          ? `Leave this line? You'll lose your place${isRestaurant ? " and the host will give your table to the next party" : ""}.`
          : isRestaurant
          ? "Are you sure you want to leave this line? You'll lose your place. If you bought a spot, your card is charged for it now -- leaving doesn't release the hold or refund it."
          : "Are you sure you want to leave this line? You'll lose your place. Spots you bought stay paid for -- leaving doesn't refund them.")
          + (currentUserPosition?.fulfilled ? "" : " If you rejoin, you'll start again at the back.")
          // Guests whose plans changed often only need a different party
          // size; leaving and rejoining would cost them their place
          + (isRestaurant && currentUserPosition && !currentUserPosition.calledAt && !currentUserPosition.fulfilled
            ? " Party size changed or running late? Cancel and update your size or add a note for the host next to your name instead -- you keep your place."
            : "")}
        confirmLabel="Leave Line"
        variant="danger"
        isLoading={loadingAction === "leave"}
        onConfirm={handleLeave}
        onCancel={() => setShowLeaveConfirm(false)}
      />

      {/* Batch Remove Confirm Modal */}
      {showBatchConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div ref={batchDialogRef} className="bg-white border border-ink p-6 max-w-sm w-full mx-4" role="dialog" aria-modal="true" aria-labelledby="batch-remove-title" aria-describedby="batch-remove-desc">
            <h3 id="batch-remove-title" className="text-lg font-semibold tracking-tight text-ink mb-2">
              Remove {selectedIds.size} {isRestaurant
                ? selectedIds.size === 1 ? "party" : "parties"
                : selectedIds.size === 1 ? "person" : "people"}?
            </h3>
            <p id="batch-remove-desc" className="text-sm text-ink/60 mb-4">
              {isRestaurant && positions.filter((p) => selectedIds.has(p.id)).every((p) => p.fulfilled)
                ? "They've already been seated, so no one's place in line changes."
                : !allowResale
                ? "Everyone behind them moves up."
                : isRestaurant
                  ? "Any of their payments still on hold can be kept (collected and paid out) or refunded. Payments already collected are final."
                  : "Swaps on this line are paid out as they happen, so purchases are final. Only a payment that couldn't be collected can still be refunded."}
            </p>
            <div className="flex flex-col space-y-2">
              <Button
                onClick={() => handleBatchRemove("payout")}
                isLoading={batchLoading}
                className="w-full"
              >
                {allowResale ? "Remove and keep purchases" : "Remove"}
              </Button>
              {allowResale && (
                <Button
                  variant="danger"
                  onClick={() => handleBatchRemove("refund")}
                  isLoading={batchLoading}
                  className="w-full"
                >
                  Remove and refund held payments
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => setShowBatchConfirm(false)}
                className="w-full"
                data-autofocus
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Resale disabled note (owners only; guests already get one line about it) */}
      {!allowResale && isCreator && positions.length > 0 && (
        <div className="bg-white border border-rule px-4 py-2.5">
          <p className="text-sm text-ink/60">Swapping is disabled for this line</p>
        </div>
      )}

      {positions.length === 0 ? (
        <p className="text-center text-ink/60 py-8" tabIndex={-1} data-dialog-fallback>
          {isCreator
            ? isPaused
              ? "No one in line, and the line is paused. Resume it so people can join online."
              : "No one in line yet. Share the line's link so people can join."
            : isPaused
            ? "No one in line yet."
            : "No one in line yet — be the first."}
        </p>
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
                    className="min-h-11 pointer-fine:min-h-0 font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
                  >
                    {selectedIds.size === positions.filter((p) => p.user.id !== session?.user?.id).length
                      ? "Deselect All"
                      : "Select All"}
                  </button>
                  <span className="font-mono text-xs uppercase tracking-widest text-ink/60 tabular-nums" aria-live="polite">
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
                aria-pressed={selectMode}
                className={`min-h-11 pointer-fine:min-h-0 font-mono text-xs uppercase tracking-widest px-3 py-1.5 border transition-colors ${
                  selectMode
                    ? "border-ink bg-ink text-paper"
                    : "border-transparent text-ink/60 hover:text-ink hover:bg-ink/5"
                }`}
              >
                {selectMode ? "Done" : "Select"}
              </button>
            </div>
          )}

          {showNameFilter && (
            <div className="pb-2">
              <label htmlFor="queue-name-filter" className="sr-only">Find by name or note</label>
              <input
                id="queue-name-filter"
                type="search"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="Find by name or note"
                autoComplete="off"
                className="w-full border border-rule bg-white px-3 py-2 text-base sm:text-sm text-ink placeholder:text-ink/60 focus:border-ink focus:outline-none"
              />
              {/* Always mounted: a live region that appears with its text isn't announced */}
              <p className={`text-xs text-ink/60 ${filterText ? "mt-1" : ""}`} aria-live="polite">
                {filterText
                  ? visiblePositions.length === 0
                    ? `No one matches "${nameFilter.trim()}".`
                    : `Showing ${visiblePositions.length} of ${positions.length}.`
                  : ""}
              </p>
            </div>
          )}

          <div className={`border border-rule divide-y divide-rule ${selectMode && selectedIds.size > 0 ? "mb-24" : ""}`} role="list" aria-label="People in line" tabIndex={-1} data-dialog-fallback>
          {visiblePositions.map((pos) => {
            const isCurrentUser = pos.user.id === session?.user?.id
            const isLocked = pos.lockedUntil && new Date(pos.lockedUntil) > new Date()
            // Served people stay listed until cleared, so the front of the
            // queue is the first unserved person, not position 1.
            const unservedAhead = unservedAheadById.get(pos.id) ?? 0
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
                role="listitem"
                id={isCurrentUser ? "my-spot" : undefined}
                // Focusable from the status card's "Manage your spot" link, so a
                // screen reader lands on the row and not back at the link
                tabIndex={isCurrentUser ? -1 : undefined}
                onClick={canSelect ? () => toggleSelection(pos.id) : undefined}
                className={`flex flex-col px-4 py-3 scroll-mt-20 ${leftBorder} ${
                  isSelected ? "bg-ink/5" : isCurrentUser ? "bg-paper" : "bg-white"
                } ${canSelect ? "cursor-pointer" : ""}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center space-x-4 min-w-0">
                    {canSelect && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelection(pos.id)}
                        onClick={(e) => e.stopPropagation()}
                        // Same number the row shows (seated rows keep their slot at a restaurant)
                        aria-label={`Select ${pos.user.name || (isRestaurant ? "party" : "person")}, ${
                          isRestaurant ? (pos.fulfilled ? "seated" : `#${unservedAhead + 1}`) : `#${pos.position}`
                        }`}
                        className="w-4 h-4 accent-ink border-rule flex-shrink-0"
                      />
                    )}
                    <div className={`min-w-8 flex-shrink-0 font-mono tabular-nums text-lg text-right ${
                      isFront ? "text-accent" : "text-ink/60"
                    }`}>
                      {/* Seated parties stay listed at a restaurant, so the raw
                          position would disagree with "You're #3" on the card */}
                      {isRestaurant
                        ? pos.fulfilled
                          ? <span role="img" aria-label="Seated">✓</span>
                          : unservedAhead + 1
                        : pos.position}
                    </div>
                    {pos.user.image ? (
                      <Image
                        src={pos.user.image}
                        alt=""
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
                          <span className="font-mono text-xs uppercase tracking-widest text-ink/60">Walk-in</span>
                        )}
                        {isFront && !pos.fulfilled && !pos.calledAt && (
                          <span className="text-sm text-green-700">(Next up)</span>
                        )}
                        {pos.calledAt && !pos.fulfilled && (
                          <span className="font-mono text-xs uppercase tracking-widest text-green-700">Called</span>
                        )}
                        {pos.calledAt && !pos.fulfilled && pos.response && (
                          <span className={`font-mono text-xs uppercase tracking-widest ${pos.response === "ON_MY_WAY" ? "text-green-700" : "text-amber-700"}`}>
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
                            <span className={`text-xs ${overQuote ? "text-amber-700" : "text-ink/60"}`}>
                              waiting {formatWaited(waited)}{overQuote && " · past quote"}
                            </span>
                          )
                        })()}
                        {isCreator && pos.calledAt && !pos.fulfilled && (() => {
                          // Walk-ins, lines without a show-up window, and parties
                          // whose window ran out get no countdown; say how long
                          // ago they were called so stale calls stand out.
                          const left = responseWindowMinutes && !pos.user.isWalkIn && !isPaused
                            ? timeLeft(callDeadline(pos.calledAt, responseWindowMinutes, pos.respondedAt, pos.graceMinutes))
                            : null
                          if (left) return null
                          const ago = Math.max(0, Math.floor((clock - new Date(pos.calledAt).getTime()) / 60_000))
                          // While paused nobody is late: the show-up clock is on hold
                          const stale = !isPaused && ago >= (responseWindowMinutes ? responseWindowMinutes * 2 : 10)
                          return (
                            <span className={`text-xs ${stale ? "text-amber-700" : "text-ink/60"}`}>
                              called {formatWaited(ago)} ago
                              {isPaused && responseWindowMinutes && !pos.user.isWalkIn && " · timer on hold"}
                            </span>
                          )
                        })()}
                        {isCreator && pos.calledAt && !pos.fulfilled && responseWindowMinutes && !pos.user.isWalkIn && !isPaused && (() => {
                          const left = timeLeft(callDeadline(pos.calledAt, responseWindowMinutes, pos.respondedAt, pos.graceMinutes))
                          if (!left) return null
                          return (
                            <span className="text-xs text-ink/60">
                              {left} left to show up{" "}
                              {/* Running late and the host is happy to wait: more time without re-calling */}
                              <button
                                onClick={() => handleGiveMoreTime(pos.id, pos.user.name)}
                                disabled={loadingAction === `grace-${pos.id}`}
                                aria-label={`Give ${pos.user.name || "this party"} 5 more minutes`}
                                className="inline-flex items-center min-h-11 px-2 -my-3 font-mono uppercase tracking-widest text-accent hover:underline underline-offset-4 disabled:opacity-50"
                              >
                                +5 min
                              </button>
                            </span>
                          )
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
                            <span className="text-xs text-ink/60 normal-case">
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
                        // In select mode a tap on the row toggles it, so no controls.
                        !selectMode && !pos.fulfilled && ((isCurrentUser && !pos.calledAt) || (isCreator && !isCurrentUser)) ? (
                          <label className="flex items-center gap-1.5 text-xs text-ink/60 mt-0.5">
                            Party of
                            <select
                              value={pos.partySize ?? 1}
                              onChange={(e) => {
                                const next = Number(e.target.value)
                                // A mis-tap from 8 to 1 frees 7 seats someone else can take
                                if (
                                  isCurrentUser && (roomLeft != null || hasCapacityLimit) && next < (pos.partySize ?? 1) &&
                                  !window.confirm("Make your party smaller? The seats you free up can go to others, and you may not get them back.")
                                ) return
                                handlePartySize(next, isCurrentUser ? undefined : pos.id)
                              }}
                              disabled={loadingAction === (isCurrentUser ? "party-size" : `party-size-${pos.id}`)}
                              className="border border-rule bg-white px-2 py-0.5 min-h-11 pointer-fine:min-h-0 text-ink"
                              // Starts with the visible "Party of" so voice control can target it
                              aria-label={isCurrentUser ? "Party of (yours)" : `Party of, ${pos.user.name || "this party"}`}
                            >
                              {/* Sizes the line can't fit only failed after picking */}
                              {Array.from(
                                { length: roomLeft != null && isCurrentUser ? Math.max(pos.partySize ?? 1, Math.min(MAX_PARTY_SIZE, (pos.partySize ?? 1) + roomLeft)) : MAX_PARTY_SIZE },
                                (_, i) => i + 1
                              ).map((n) => (
                                <option key={n} value={n}>{n}</option>
                              ))}
                            </select>
                            {/* The list stops where the line's room runs out; say why */}
                            {isCurrentUser && roomLeft != null && (pos.partySize ?? 1) + roomLeft < MAX_PARTY_SIZE && (
                              <span>{roomLeft === 0 ? "Line's full. Bigger party? Ask the host." : "Bigger party? Ask the host."}</span>
                            )}
                          </label>
                        ) : (
                          <p className="text-xs text-ink/60 mt-0.5">
                            Party of {pos.partySize ?? 1}
                            {isCurrentUser && pos.calledAt && !pos.fulfilled && " (ask the host to change)"}
                          </p>
                        )
                      )}
                      {isRestaurant && !selectMode && !pos.fulfilled && (isCurrentUser || isCreator) && (
                        <NoteField
                          key={pos.id}
                          initial={pos.note ?? ""}
                          label={isCurrentUser ? "Note for the host" : `Note for ${pos.user.name || "this party"}`}
                          saving={loadingAction === (isCurrentUser ? "note" : `note-${pos.id}`)}
                          onSave={(note) => handleNote(note, isCurrentUser ? undefined : pos.id)}
                        />
                      )}
                      {isRestaurant && pos.fulfilled && pos.note && (isCurrentUser || isCreator) && (
                        <p className="text-xs text-ink/60 mt-0.5 break-words">Note: {pos.note}</p>
                      )}
                      {isCreator && !isCurrentUser && !pos.fulfilled && !selectMode && (
                        <label className="flex items-center gap-1.5 text-xs text-ink/60 mt-0.5">
                          Quote
                          <select
                            value={pos.quotedMinutes ?? ""}
                            onChange={(e) => handleQuote(pos.id, e.target.value ? Number(e.target.value) : null)}
                            disabled={loadingAction === `quote-${pos.id}`}
                            className="border border-rule bg-white px-2 py-0.5 min-h-11 pointer-fine:min-h-0 text-ink"
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
                            <span className="text-ink/60">
                              at {new Date(pos.quotedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                            </span>
                          )}
                        </label>
                      )}
                      {isLocked && (
                        <p className="font-mono text-xs uppercase tracking-widest text-amber-700 flex items-center gap-1.5 mt-0.5">
                          <span className="inline-block w-1.5 h-1.5 flex-shrink-0 bg-amber-600" />
                          Swap pending
                        </p>
                      )}
                      {!isFront && !isPaused && !pos.fulfilled && !pos.calledAt && !isCurrentUser && waitTimeData?.estimatedMinutesPerPerson != null && (
                        <p className="text-xs text-ink/60">
                          Est. wait: {formatWaitTime(waitTimeData.estimatedMinutesPerPerson * unservedAhead)}
                        </p>
                      )}
                    </div>
                  </div>

                  {!selectMode && (
                    // Indented on mobile to line up under the name (number + avatar + gaps)
                    <div className="flex items-center flex-wrap gap-2 pl-26 sm:pl-0 sm:flex-shrink-0">
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
                          onClick={() => {
                            if (pos.calledAt && (pos.response || pos.graceMinutes)) {
                              const name = pos.user.name || "this party"
                              const replyLabel = pos.response === "ON_MY_WAY" ? "On the way" : "Running late"
                              setRecallConfirm({
                                positionId: pos.id,
                                message: pos.response
                                  ? `Call ${name} again? Their "${replyLabel}" reply and extra time will be cleared.`
                                  : `Call ${name} again? Their extra time will be cleared.`,
                              })
                              return
                            }
                            handleCall(pos.id, !!pos.calledAt || pos.user.id === nowServingUserId)
                          }}
                          disabled={loadingAction === `call-${pos.id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 min-h-11 pointer-fine:min-h-[2.25rem] font-mono text-xs uppercase tracking-widest text-accent border border-rule hover:border-accent transition-colors disabled:opacity-50"
                          title={`Call this party of ${pos.partySize ?? 1}`}
                          aria-label={`${pos.calledAt || pos.user.id === nowServingUserId ? "Call again" : "Call"} ${pos.user.name || "this party"}, party of ${pos.partySize ?? 1}`}
                        >
                          {pos.calledAt || pos.user.id === nowServingUserId ? "Call again" : "Call"}
                        </button>
                      )}
                      {isCreator && !isCurrentUser && !pos.fulfilled && (
                        <button
                          onClick={() => {
                            const name = pos.user.name || (isRestaurant ? "this party" : "this person")
                            // Same as the console: someone already called (or a walk-in at the
                            // stand) is seated in one tap; only an uncalled online party asks first
                            // The row's controls go away once seated: keep keyboard focus in the list
                            if (isRestaurant && (pos.calledAt || pos.user.isWalkIn)) void handleFulfill(pos.id, name).then(focusListSoon)
                            else setFulfillConfirm({ positionId: pos.id, name })
                          }}
                          // A swap in progress is called off by seating (the buyer isn't charged)
                          disabled={loadingAction === `fulfill-${pos.id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 min-h-11 pointer-fine:min-h-[2.25rem] font-mono text-xs uppercase tracking-widest text-green-700 border border-rule hover:border-green-700 transition-colors disabled:opacity-50"
                          title={isLocked ? `A swap for this spot is in progress -- ${isRestaurant ? "seating" : "serving"} cancels it` : isRestaurant ? "Mark as seated" : "Mark as served"}
                          aria-label={`${isRestaurant ? "Mark seated:" : "Mark served:"} ${pos.user.name || (isRestaurant ? "this party" : "this person")}`}
                        >
                          {loadingAction === `fulfill-${pos.id}` && (
                            <div className="w-3 h-3 border-2 border-green-700 border-t-transparent rounded-full animate-spin" />
                          )}
                          {isRestaurant ? "Seated" : "Served"}
                        </button>
                      )}
                      {isCreator && !isCurrentUser && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => openRemovalModal(pos.id, pos.user.id, pos.user.name, !!pos.calledAt && !pos.fulfilled, { isWalkIn: pos.user.isWalkIn, partySize: pos.partySize, fulfilled: !!pos.fulfilled, calledAt: pos.calledAt, graceMinutes: pos.graceMinutes, response: pos.response })}
                          aria-label={`Remove ${pos.user.name || (isRestaurant ? "this party" : "this person")}`}
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
                      <p className="text-xs text-ink/60 mt-0.5">
                        You&apos;d receive {formatCurrency(offer.amount)} and move back one spot.
                        {isRestaurant && " You're paid once the buyer is seated. If the host releases their card instead, you aren't paid."}
                        {offer.expiresAt && ` Expires in ${formatTimeLeft(offer.expiresAt)}.`}
                      </p>
                      {allowResale && !isPaused && !offMarket(pos) && pos.askingPrice == null && (
                        <p className="text-xs text-ink/60 mt-0.5">
                          Want more? List your spot at your price first -- they&apos;ll see a Buy button -- then decline this offer.
                        </p>
                      )}
                      {isPaused ? (
                        // Accepting waits for the line to resume; turning it down doesn't
                        <div className="mt-2 flex items-center gap-3 flex-wrap">
                          <p className="text-xs text-ink/60">
                            Swaps are paused. You can accept this when the line resumes.
                          </p>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRespondToOffer(offer, "decline")}
                            isLoading={loadingAction === `offer-${offer.id}-decline`}
                          >
                            Decline
                          </Button>
                        </div>
                      ) : isLocked ? (
                        <p className="text-xs text-ink/60 mt-2">
                          {payingForOffer || myCheckout?.pending
                            ? "Finish or cancel your payment for the spot ahead first, then you can answer this."
                            : "A swap for your spot is in progress right now. You can answer this once it finishes."}
                        </p>
                      ) : allowResale && !offMarket(pos) && (
                        <div className="flex items-center gap-2 mt-2">
                          <Button
                            size="sm"
                            onClick={() => setAcceptConfirm(offer)}
                            isLoading={loadingAction === `offer-${offer.id}-accept`}
                            disabled={loadingAction === `offer-${offer.id}-decline`}
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRespondToOffer(offer, "decline")}
                            isLoading={loadingAction === `offer-${offer.id}-decline`}
                            disabled={loadingAction === `offer-${offer.id}-accept`}
                          >
                            Decline
                          </Button>
                        </div>
                      )}
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
                      <p className="text-xs text-ink/60 mt-0.5">
                        Both spots are held until they pay or the payment window closes. If they don&apos;t pay in time, the swap is off and you keep your spot.
                        {isLocked && pos.lockedUntil && ` They have ${formatTimeLeft(pos.lockedUntil)} left.`}
                      </p>
                    </div>
                  )
                })}

                {/* A purchase this user started but hasn't paid for. Kept outside
                    the listing gate so they can still resume or cancel it if
                    the line pauses mid-checkout. */}
                {isCurrentUser && !selectMode && isLocked && myCheckout?.pending && (
                  <div className="mt-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-sm text-ink/70">You started buying the spot ahead but haven&apos;t paid yet{myLockUntil && new Date(myLockUntil) > new Date() ? ` (${formatTimeLeft(myLockUntil)} left)` : ""}.</p>
                        {myCheckout.url && (
                          <a
                            href={myCheckout.url}
                            className="font-mono text-xs uppercase tracking-widest text-ink hover:text-accent underline underline-offset-4"
                          >
                            Resume payment
                          </a>
                        )}
                        <button
                          onClick={() => setCancelCheckoutConfirm(true)}
                          disabled={loadingAction === "cancel-checkout"}
                          className="font-mono text-xs uppercase tracking-widest text-ink/60 hover:text-ink underline underline-offset-4 disabled:opacity-50"
                        >
                          Cancel purchase
                        </button>
                      </div>
                  </div>
                )}

                {/* List / re-price / un-list the current user's own position */}
                {isCurrentUser && allowResale && !isPaused && !selectMode && !offMarket(pos) && !(isLocked && myCheckout?.pending) && (
                  <div className="mt-3">
                    {isLocked ? (
                      // Our spot locks when we're the buyer too, so only show the
                      // seller copy once we know it isn't our own purchase.
                      payingForOffer ? (
                        <p className="text-sm text-ink/60">Your spot is held while you pay for the spot ahead.</p>
                      ) : myCheckout === null || receivedOffers.some((o) => o.status === "ACCEPTED" && o.awaitingPayment) ? null : (
                        <p className="text-sm text-ink/60">
                          {pos.lockedUntil
                            ? `Someone is paying for your spot. If they don't finish in ${formatTimeLeft(pos.lockedUntil)}, it stays yours.`
                            : "Your position is locked while a swap is in progress."}
                        </p>
                      )
                    ) : pos.askingPrice != null ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm text-ink/70">
                          Listed for{" "}
                          <span className="font-mono tabular-nums">{formatCurrency(pos.askingPrice)}</span>
                          {feeInfo && (
                            <span className="text-ink/60">
                              {" "}(you get {formatCurrency(pos.askingPrice)}; buyer pays {formatCurrency(buyerTotal(pos.askingPrice))})
                            </span>
                          )}
                        </p>
                        <button
                          onClick={() => handleSetPrice(null)}
                          disabled={priceLoading}
                          className="font-mono text-xs uppercase tracking-widest text-ink/60 hover:text-ink underline underline-offset-4 disabled:opacity-50"
                        >
                          Remove from sale
                        </button>
                      </div>
                    ) : listPriceFormOpen ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative flex-1 sm:flex-none">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-ink/60">$</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            enterKeyHint="done"
                            min="1"
                            max={maxAskingPrice ?? undefined}
                            step="0.01"
                            placeholder="0.00"
                            aria-label="Asking price for your spot"
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" || priceLoading || !(parseFloat(listPriceAmount) >= 1)) return
                              if (maxAskingPrice != null && parseFloat(listPriceAmount) > maxAskingPrice) return
                              e.preventDefault()
                              handleSetPrice(parseFloat(listPriceAmount))
                            }}
                            // The button that opened this form is gone; focus belongs here
                            autoFocus
                            aria-invalid={maxAskingPrice != null && !!listPriceAmount && parseFloat(listPriceAmount) > maxAskingPrice}
                            aria-describedby={maxAskingPrice != null ? `list-max-${pos.id}` : undefined}
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
                          className="text-sm text-ink/60 hover:text-ink"
                        >
                          Cancel
                        </button>
                        {maxAskingPrice != null && (
                          <span id={`list-max-${pos.id}`} className={`text-xs font-mono tabular-nums ${
                            listPriceAmount && parseFloat(listPriceAmount) > maxAskingPrice
                              ? "text-accent"
                              : "text-ink/60"
                          }`}>
                            {listPriceAmount && parseFloat(listPriceAmount) > maxAskingPrice ? "Over the max of " : "Max: "}
                            {formatCurrency(maxAskingPrice)}
                          </span>
                        )}
                        {parseFloat(listPriceAmount) >= 1 && (
                          <p className="w-full text-xs text-ink/60">
                            You get {formatCurrency(parseFloat(listPriceAmount))}
                            {feeInfo && <>; buyer pays {formatCurrency(buyerTotal(parseFloat(listPriceAmount)))} incl. fees</>}.
                          </p>
                        )}
                        {/* Checkout only sells to the next spot back: a seller with no one
                            there (or a walk-in, who can't pay) waited for a buyer who can't exist */}
                        {(() => {
                          const behind = positions.find((p) => p.position === pos.position + 1)
                          return (
                            <p className="w-full text-xs text-ink/60">
                              Only the person directly behind you can buy it.
                              {(!behind || behind.user.isWalkIn) && " No one who can buy is behind you right now."}
                            </p>
                          )
                        })()}
                      </div>
                    ) : (
                      <button
                        onClick={() => setListPriceFormOpen(true)}
                        className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
                      >
                        List Your Spot For Sale
                      </button>
                    )}
                    {/* With an offer pending, the offer card above already says this */}
                    {isRestaurant && (pos.askingPrice != null || listPriceFormOpen) && !hasIncomingOffer && (
                      <p className="mt-1 text-xs text-ink/60">
                        You&apos;re paid once the buyer is seated. If the host releases their card instead, you aren&apos;t paid.
                      </p>
                    )}
                    {stripeEnabled && !hasPayoutSetup && (pos.askingPrice != null || listPriceFormOpen || hasIncomingOffer) && (
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
                    to reach their payment link -- even if the line pauses. */}
                {isDirectlyInFront && !isCurrentUser && allowResale && !selectMode && pos.user.isWalkIn && !offMarket(pos) && (
                  <p className="mt-3 text-xs text-ink/60">Added by the host at the stand -- this spot can&apos;t be bought or offered on.</p>
                )}
                {/* Buy and Offer used to vanish with no reason */}
                {isDirectlyInFront && !isCurrentUser && allowResale && !selectMode && offMarket(pos) &&
                  currentUserPosition && !offMarket(currentUserPosition) && (
                  <p className="mt-3 text-xs text-ink/60">
                    {pos.fulfilled
                      ? `They've been ${isRestaurant ? "seated" : "served"}, so there's no spot ahead of you to buy right now.`
                      : `They've been called up, so their spot can't be bought or offered on.`}
                  </p>
                )}
                {/* A pending offer stays live while paused: keep it (and Withdraw) in view */}
                {isDirectlyInFront && !isCurrentUser && allowResale && (!isPaused || payingForOffer || sentOfferToFront?.status === "PENDING") && !selectMode && !pos.user.isWalkIn &&
                  !offMarket(pos) && !(currentUserPosition && offMarket(currentUserPosition)) && (
                  <div className="mt-3 space-y-2">
                    {pos.askingPrice != null && !isLocked && !myLockActive && !isPaused && (
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
                        <p className="text-xs text-ink/60 mt-0.5">
                          Pay {formatCurrency(sentOfferToFront.chargeTotal ?? buyerTotal(sentOfferToFront.amount))} (incl. fees) to take their spot.{" "}
                          {!pos.lockedUntil
                            ? "Both spots are held for you for up to 30 minutes."
                            : isLocked
                            ? `Both spots are held for you for ${formatTimeLeft(pos.lockedUntil)} more.`
                            : "The payment window has closed."}
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
                            onClick={() => setWithdrawConfirm({ offerId: sentOfferToFront.id, accepted: true })}
                            isLoading={loadingAction === `withdraw-${sentOfferToFront.id}`}
                          >
                            Back Out
                          </Button>
                        </div>
                      </div>
                    ) : isLocked || myLockActive ? (
                      // Buttons gone with no reason left buyers guessing
                      myCheckout?.pending ? null : sentOfferToFront?.status === "PENDING" ? (
                        // Their offer looked like it had vanished, with no way to withdraw it
                        <div className="flex items-center gap-3 flex-wrap">
                          <p className="text-xs text-ink/60">
                            Your {formatCurrency(sentOfferToFront.amount)} offer is still pending, but{" "}
                            {myLockActive
                              ? "someone behind you is paying for your spot right now, so they can't answer until that finishes."
                              : `they're in the middle of another swap, so they can't answer until it finishes${pos.lockedUntil ? ` (up to ${formatTimeLeft(pos.lockedUntil)})` : ""}.`}
                          </p>
                          <button
                            onClick={() => setWithdrawConfirm({ offerId: sentOfferToFront.id, accepted: false })}
                            disabled={loadingAction === `withdraw-${sentOfferToFront.id}`}
                            className="min-h-11 pointer-fine:min-h-0 font-mono text-xs uppercase tracking-widest text-ink/60 hover:text-ink underline underline-offset-4 disabled:opacity-50"
                          >
                            Withdraw
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-ink/60">
                          {myLockActive
                            ? "Someone behind you is paying for your spot right now. You can buy or make an offer once that finishes."
                            : `They're in the middle of another swap. You can buy or make an offer once it finishes${pos.lockedUntil ? ` (up to ${formatTimeLeft(pos.lockedUntil)})` : ""}.`}
                        </p>
                      )
                    ) : sentOfferToFront?.status === "PENDING" && offerFormOpen !== pos.user.id ? (
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-sm text-ink/60">
                          Offer sent: {formatCurrency(sentOfferToFront.amount)} (you&apos;d pay {formatCurrency(buyerTotal(sentOfferToFront.amount))} incl. fees) -- waiting for response
                          {sentOfferToFront.expiresAt && ` (expires in ${formatTimeLeft(sentOfferToFront.expiresAt)})`}
                        </p>
                        {isPaused ? (
                          // Offers can't be raised while paused
                          <span className="text-xs text-ink/60">Line paused.</span>
                        ) : maxAskingPrice != null && sentOfferToFront.amount >= maxAskingPrice ? (
                          // Every higher amount is over the line's max: Raise was a dead end
                          <span className="text-xs text-ink/60">That&apos;s the line&apos;s max.</span>
                        ) : (
                          <button
                            onClick={() => {
                              // Start a dollar up: the current amount itself is refused as "not a raise"
                              setOfferAmount(Math.min(sentOfferToFront.amount + 1, maxAskingPrice ?? Infinity).toFixed(2))
                              setOfferFormOpen(pos.user.id)
                            }}
                            className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
                          >
                            Raise
                          </button>
                        )}
                        <button
                          onClick={() => setWithdrawConfirm({ offerId: sentOfferToFront.id, accepted: false })}
                          disabled={loadingAction === `withdraw-${sentOfferToFront.id}`}
                          className="font-mono text-xs uppercase tracking-widest text-ink/60 hover:text-ink underline underline-offset-4 disabled:opacity-50"
                        >
                          Withdraw
                        </button>
                      </div>
                    ) : sentOfferToFront && ["DECLINED", "EXPIRED", "WITHDRAWN"].includes(sentOfferToFront.status) && offerFormOpen !== pos.user.id ? ((() => {
                      // The server holds off a new offer for a while after a
                      // decline or withdrawal; say so up front instead of
                      // letting them type one only to have it bounced.
                      const cooldownLeft = sentOfferToFront.status === "EXPIRED"
                        ? 0
                        : new Date(sentOfferToFront.createdAt).getTime() + OFFER_COOLDOWN_MS - Date.now()
                      return (
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-sm text-ink/60">
                          {sentOfferToFront.status === "WITHDRAWN"
                            ? `You withdrew your ${formatCurrency(sentOfferToFront.amount)} offer.`
                            : `Your ${formatCurrency(sentOfferToFront.amount)} offer ${sentOfferToFront.status === "DECLINED" ? "was declined" : "expired"}.`}
                          {sentOfferToFront.status === "DECLINED" && pos.askingPrice != null &&
                            ` They listed their spot at ${formatCurrency(pos.askingPrice)}${buyerTotal(pos.askingPrice) !== pos.askingPrice ? ` (${formatCurrency(buyerTotal(pos.askingPrice))} incl. fees)` : ""} instead, so you can buy it outright.`}
                          {cooldownLeft > 0 && ` You can make a new one in ${Math.ceil(cooldownLeft / 60_000)} min.`}
                        </p>
                        {cooldownLeft <= 0 && (
                        <button
                          onClick={() => setOfferFormOpen(pos.user.id)}
                          className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
                        >
                          Make a New Offer
                        </button>
                        )}
                      </div>
                      )
                    })()
                    ) : offerFormOpen === pos.user.id ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative flex-1 sm:flex-none">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-ink/60">$</span>
                          <input
                            type="number"
                            min={sentOfferToFront?.status === "PENDING" ? (sentOfferToFront.amount + 0.01).toFixed(2) : "1"}
                            max={maxAskingPrice ?? undefined}
                            inputMode="decimal"
                            enterKeyHint="send"
                            step="0.01"
                            placeholder="0.00"
                            aria-label="Your offer"
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" || offerLoading || !(parseFloat(offerAmount) >= 1)) return
                              if (maxAskingPrice != null && parseFloat(offerAmount) > maxAskingPrice) return
                              e.preventDefault()
                              handleSendOffer(pos.user.id)
                            }}
                            autoFocus
                            aria-invalid={maxAskingPrice != null && !!offerAmount && parseFloat(offerAmount) > maxAskingPrice}
                            aria-describedby={maxAskingPrice != null ? `offer-max-${pos.id}` : undefined}
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
                          {sentOfferToFront?.status === "PENDING" ? "Raise Offer" : "Send Offer"}
                        </Button>
                        <button
                          onClick={() => { setOfferFormOpen(null); setOfferAmount("") }}
                          className="text-sm text-ink/60 hover:text-ink"
                        >
                          Cancel
                        </button>
                        {maxAskingPrice != null && (
                          <span id={`offer-max-${pos.id}`} className={`text-xs font-mono tabular-nums ${
                            offerAmount && parseFloat(offerAmount) > maxAskingPrice
                              ? "text-accent"
                              : "text-ink/60"
                          }`}>
                            {offerAmount && parseFloat(offerAmount) > maxAskingPrice ? "Over the max of " : "Max: "}
                            {formatCurrency(maxAskingPrice)}
                          </span>
                        )}
                        {sentOfferToFront?.status === "PENDING" && (
                          <span className="text-xs font-mono tabular-nums text-ink/60">
                            Current offer: {formatCurrency(sentOfferToFront.amount)}
                          </span>
                        )}
                        {parseFloat(offerAmount) >= 1 && (
                          <span className="w-full text-xs text-ink/60">
                            They receive {formatCurrency(Math.round(parseFloat(offerAmount) * 100) / 100)}; you&apos;d pay {formatCurrency(buyerTotal(Math.round(parseFloat(offerAmount) * 100) / 100))} incl. fees if they accept.
                            {" "}If they do, both spots are held and you have 30 min to pay.
                            {stripeEnabled && (isRestaurant
                              ? " Your card is held, not charged, until you're seated."
                              : " Once paid, the purchase is final.")}
                          </span>
                        )}
                        {pos.askingPrice != null && parseFloat(offerAmount) >= pos.askingPrice && (
                          <span className="w-full text-xs text-amber-700">
                            They&apos;re listed at {formatCurrency(pos.askingPrice)}. Buying outright {parseFloat(offerAmount) > pos.askingPrice ? "is cheaper" : "costs the same"} and doesn&apos;t need them to accept.
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
        <div data-action-bar role="region" aria-label="Selected parties" className="fixed bottom-0 left-0 right-0 bg-white border-t border-ink z-40 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
  onSave: (note: string) => Promise<boolean>
}) {
  const [value, setValue] = useState(initial)
  const [focused, setFocused] = useState(false)
  // Pick up the other side's edit, but never wipe a draft being typed
  const [seenInitial, setSeenInitial] = useState(initial)
  if (initial !== seenInitial && !focused) {
    setSeenInitial(initial)
    setValue(initial)
  }
  const dirty = value.trim() !== initial.trim()
  // Enter saves without leaving the field, so the later blur mustn't send it again
  const lastSaved = useRef<string | null>(null)
  const save = () => {
    if (dirty && value !== lastSaved.current) {
      lastSaved.current = value
      // A save lost to a weak signal must not block tapping Save again
      void onSave(value).then((ok) => { if (!ok && lastSaved.current === value) lastSaved.current = null })
    }
  }
  // Locking the phone or switching apps often skips blur; save the draft then too
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save })
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") saveRef.current() }
    document.addEventListener("visibilitychange", onHide)
    return () => document.removeEventListener("visibilitychange", onHide)
  }, [])
  return (
    <div className="mt-1 flex items-center gap-2 max-w-xs">
      <input
        type="text"
        value={value}
        maxLength={140}
        placeholder="Add a note (high chair, patio...)"
        aria-label={label}
        // readOnly, not disabled: disabling pushed keyboard focus out of the field
        readOnly={saving}
        onChange={(e) => { lastSaved.current = null; setValue(e.target.value) }}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); save() }}
        onKeyDown={(e) => {
          // Save in place: blurring dropped keyboard focus to the top of the page
          if (e.key === "Enter") {
            e.preventDefault()
            save()
          }
        }}
        className="w-full min-h-11 pointer-fine:min-h-0 border border-rule bg-white px-2 py-1 text-base sm:text-sm text-ink placeholder:text-ink/60 focus:outline-none focus:border-ink read-only:opacity-50"
      />
      {dirty && (
        <button
          type="button"
          // Keep the tap from blurring first and saving twice
          onMouseDown={(e) => e.preventDefault()}
          onClick={save}
          disabled={saving}
          className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4 min-h-11 pointer-fine:min-h-0 disabled:opacity-50"
        >
          Save
        </button>
      )}
    </div>
  )
}
