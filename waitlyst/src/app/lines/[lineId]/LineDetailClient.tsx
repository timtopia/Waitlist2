"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useSession, signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/Button"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { QueueDisplay } from "@/components/QueueDisplay"
import { LineStatusBanner } from "@/components/LineStatusBanner"
import { ShareLine } from "@/components/ShareLine"
import { ConfirmModal } from "@/components/ui/ConfirmModal"
import { DropdownMenu } from "@/components/ui/DropdownMenu"
import { useToast } from "@/components/ui/Toast"
import { useLineUpdates, LineUpdateEvent } from "@/hooks/useLineUpdates"
import { useNotifications } from "@/hooks/useNotifications"
import { useWakeLock } from "@/hooks/useWakeLock"
import { alertTurn, primeChime } from "@/lib/attention"
import { MemberStatusCard, NotificationState } from "@/components/MemberStatusCard"
import { OwnerConsole } from "@/components/OwnerConsole"
import { timeAgo } from "@/lib/format"
import { MAX_PARTY_SIZE, capacityUnit, guestCount } from "@/lib/capacity"
import { getMemberStatus, diffMemberStatus, describeMemberEvent, memberTabTitle } from "@/lib/member-status"

interface ActivityItem {
  id: string
  type: "join" | "purchase" | "sale" | "refund"
  description: string
  timestamp: string
}

interface Line {
  id: string
  name: string
  description: string | null
  isActive: boolean
  opensAt: string | null
  closesAt: string | null
  maxCapacity: number | null // null when hidden from this viewer
  hasCapacityLimit: boolean
  isFull: boolean
  /** Capacity used as the server counts it (see capacityUsed) */
  capacityUsed: number
  /** Notification emails are set up on the server */
  emailEnabled: boolean
  ownerFeePercent: number
  platformFeePercent: number
  announcement: string | null
  announcementAt: string | null
  productName: string | null
  productImage: string | null
  productPrice: number | null
  productUrl: string | null
  allowResale: boolean
  maxAskingPrice: number | null
  nowServing: string | null
  nowServingUserId: string | null
  nowServingAt: string | null
  hideCapacity: boolean
  kind: "STANDARD" | "RESTAURANT"
  purchaseLimit: number | null
  responseWindowMinutes: number | null
  createdAt: string
  createdBy: {
    id: string
    name: string | null
    image: string | null
  }
  positions: {
    id: string
    position: number
    askingPrice: number | null
    lockedUntil: string | null
    fulfilled: boolean
    fulfilledAt: string | null
    calledAt: string | null
    partySize: number
    note?: string | null
    quotedMinutes?: number | null
    quotedAt?: string | null
    response?: "ON_MY_WAY" | "RUNNING_LATE" | null
    respondedAt?: string | null
    graceMinutes?: number
    user: {
      id: string
      name: string | null
      image: string | null
      isWalkIn?: boolean
    }
  }[]
}

export function LineDetailClient({ lineId }: { lineId: string }) {
  const { data: session, status } = useSession()
  const [line, setLine] = useState<Line | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [partySize, setPartySize] = useState(2)
  // Whether the guest chose the size themselves (vs. the default of 2), so a
  // size that stops fitting is raised with them instead of quietly shrunk
  const [partySizeChosen, setPartySizeChosen] = useState(false)
  const [joinNote, setJoinNote] = useState("")
  const [remindMe, setRemindMe] = useState<boolean | null>(null)
  const [remindBusy, setRemindBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notificationPermission, setNotificationPermission] = useState<NotificationState>("unsupported")
  const notificationsEnabled = notificationPermission === "granted"
  const [departure, setDeparture] = useState<{ wasServed: boolean; wasCalled: boolean } | null>(null)
  // Set when the viewer leaves from this tab, so the next poll isn't
  // reported as "you're no longer in line".
  const leftHereRef = useRef(false)
  const [, setScheduleTick] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAnnouncementEditor, setShowAnnouncementEditor] = useState(false)
  const [announcementDraft, setAnnouncementDraft] = useState("")
  const [savingAnnouncement, setSavingAnnouncement] = useState(false)
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(true)
  const [showAllActivity, setShowAllActivity] = useState(false)
  const [hasPayoutSetup, setHasPayoutSetup] = useState(false)
  const [stripeEnabled, setStripeEnabled] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { requestPermission, sendNotification } = useNotifications()
  const { addToast } = useToast()
  const [justCreated, setJustCreated] = useState(() => searchParams.get("created") === "1")

  useEffect(() => {
    if (searchParams.get("created") === "1") router.replace(`/lines/${lineId}`, { scroll: false })
  }, [searchParams, lineId, router])

  // Derive fee info from line data — updates automatically when line data changes via polling
  const feeInfo = line ? {
    ownerFeePercent: line.ownerFeePercent,
    platformFeePercent: line.platformFeePercent,
  } : undefined

  // Handle payment status from Stripe redirect
  useEffect(() => {
    const paymentStatus = searchParams.get("payment")
    if (paymentStatus === "success") {
      addToast("Payment successful! Your position has been swapped.", "success")
      // Clean up URL
      router.replace(`/lines/${lineId}`, { scroll: false })
    } else if (paymentStatus === "cancelled") {
      addToast("Payment was cancelled. No charges were made.", "info")
    } else if (paymentStatus === "offer_withdrawn") {
      addToast("Payment was cancelled and your offer withdrawn. No charges were made.", "info")
      router.replace(`/lines/${lineId}`, { scroll: false })
    } else if (paymentStatus === "error") {
      const reason = searchParams.get("reason")
      const messages: Record<string, string> = {
        missing_session: "Payment session not found.",
        stripe_not_configured: "Payment system is not configured.",
        not_paid: "Payment was not completed.",
        no_transaction: "Transaction could not be found.",
        invalid_transaction: "Invalid transaction.",
        swap_failed: "The spot you were buying changed hands before the swap could finish (they moved, left, or were called), so it was cancelled. The hold on your card has been released.",
      }
      addToast(messages[reason || ""] || "Something went wrong with your payment.", "error")
      router.replace(`/lines/${lineId}`, { scroll: false })
    }
  }, [searchParams, lineId, addToast, router])

  // Handle Stripe Connect onboarding status, if the user set up payouts
  // from this page (e.g. right after listing their position for sale).
  useEffect(() => {
    const connectStatus = searchParams.get("connect")
    if (connectStatus === "success") {
      setHasPayoutSetup(true)
      addToast("Payout account connected -- you'll now get paid for swaps.", "success")
      router.replace(`/lines/${lineId}`, { scroll: false })
    } else if (connectStatus === "incomplete") {
      addToast("Payout setup isn't finished yet. Pick it back up whenever you're ready.", "info")
      router.replace(`/lines/${lineId}`, { scroll: false })
    } else if (connectStatus === "error") {
      addToast("Something went wrong connecting your payout account. Please try again.", "error")
      router.replace(`/lines/${lineId}`, { scroll: false })
    }
  }, [searchParams, lineId, addToast, router])

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotificationPermission(Notification.permission)
    }
  }, [])

  async function enableNotifications() {
    const result = await requestPermission()
    setNotificationPermission(result)
  }

  // Fetch current user's payout setup status
  useEffect(() => {
    if (!session?.user?.id) return
    async function fetchPayoutStatus() {
      try {
        const res = await fetch("/api/user")
        if (res.ok) {
          const data = await res.json()
          setHasPayoutSetup(!!data.stripeConnectOnboarded)
          setStripeEnabled(!!data.stripeEnabled)
        }
      } catch {
        // Non-critical — default to false
      }
    }
    fetchPayoutStatus()
  }, [session?.user?.id])

  const fetchLine = useCallback(async () => {
    try {
      const res = await fetch(`/api/lines/${lineId}`)
      if (res.ok) {
        const data = await res.json()
        setLine(data)
      } else {
        setError("Line not found")
      }
    } catch {
      setError("Failed to load line")
    } finally {
      setLoading(false)
    }
  }, [lineId])

  useEffect(() => {
    fetchLine()
  }, [fetchLine])

  // Fetch line-specific activity feed
  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch(`/api/lines/${lineId}/activity`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          setActivities(data)
        }
      }
    } finally {
      setActivitiesLoading(false)
    }
  }, [lineId])

  useEffect(() => {
    fetchActivity()
  }, [fetchActivity])

  // After the viewer's own action (join, buy, list, swap), refresh the
  // activity feed too -- otherwise it lags until the next background poll.
  const refreshAll = useCallback(() => {
    fetchLine()
    fetchActivity()
  }, [fetchLine, fetchActivity])

  // Diff polls against what's on screen, not the previous poll: the viewer's
  // own actions already refetched the line, so they never alert themselves.
  const lineRef = useRef<Line | null>(null)
  useEffect(() => {
    lineRef.current = line
  }, [line])

  const handleLineUpdate = useCallback((event: LineUpdateEvent) => {
    if (event.type === "delete") {
      const prev = lineRef.current
      const wasMember = !!prev && !!getMemberStatus(prev, session?.user?.id)
      setLine(null)
      setError("This line was deleted by its organizer.")
      if (wasMember && prev) {
        sendNotification("Line closed", { body: `${prev.name} was deleted by its organizer.`, tag: `waitlyst-${lineId}` })
        addToast(`${prev.name} was deleted by its organizer.`, "warning")
      }
      return
    }
    if (event.type !== "poll-update" || !event.data) return
    const next = event.data as Line
    const prev = lineRef.current
    setLine(next)
    fetchActivity()
    if (!prev) return

    // Back in the line (rejoined): a later removal must be announced, not
    // swallowed as the leave from this tab
    if (getMemberStatus(next, session?.user?.id)) leftHereRef.current = false

    for (const change of diffMemberStatus(prev, next, session?.user?.id)) {
      if (change.kind === "removed" && leftHereRef.current) {
        leftHereRef.current = false
        continue
      }
      if (change.kind === "removed") setDeparture({ wasServed: change.wasServed, wasCalled: change.wasCalled })
      if (change.kind === "called" || change.kind === "next") setDeparture(null)
      if (change.kind === "called") alertTurn()
      const alert = describeMemberEvent(change, next.name)
      if (!alert) continue
      sendNotification(alert.title, { body: alert.body, tag: `waitlyst-${lineId}` })
      if (alert.toast && document.visibilityState === "visible") {
        addToast(`${alert.title}: ${alert.body}`, alert.tone)
      }
    }
  }, [fetchActivity, sendNotification, addToast, session?.user?.id, lineId])

  const memberStatus = line ? getMemberStatus(line, session?.user?.id) : null
  const nearFront = !!memberStatus && memberStatus.phase !== "served" && memberStatus.ahead <= 2

  // Near the front: keep the screen on so the page keeps checking, and get
  // the chime ready (it needs a tap first) for when they're called.
  const awaitingTurn = !!memberStatus && memberStatus.phase !== "served" && (nearFront || memberStatus.phase === "called")
  useWakeLock(awaitingTurn)
  const inLine = !!memberStatus
  useEffect(() => {
    if (!inLine) return
    document.addEventListener("pointerdown", primeChime, { once: true })
    return () => document.removeEventListener("pointerdown", primeChime)
  }, [inLine])

  // The host at the stand needs online joins and "on my way" taps promptly
  const hostingLive = !!line?.isActive && line.createdBy.id === session?.user?.id
  useLineUpdates(lineId, handleLineUpdate, {
    intervalMs: nearFront || hostingLive ? 10000 : 30000,
    pollWhenHidden: !!memberStatus && notificationsEnabled,
  })

  const tabTitle = line ? memberTabTitle(memberStatus, line.name) : null
  useEffect(() => {
    if (!tabTitle) return
    const original = document.title
    document.title = tabTitle
    return () => {
      document.title = original
    }
  }, [tabTitle])

  const isInLine = inLine
  const isCreator = line?.createdBy.id === session?.user?.id

  const now = new Date()
  const linePaused = line ? !line.isActive : false
  const lineNotYetOpen = line?.opensAt && now < new Date(line.opensAt)
  const lineClosed = line?.closesAt && now > new Date(line.closesAt)
  const lineFull = line?.isFull ?? false
  const canJoin = !isInLine && !isCreator && !lineNotYetOpen && !lineClosed && !lineFull && !linePaused
  const userPosition = line?.positions.find((p) => p.user.id === session?.user?.id)
  const isRestaurant = line?.kind === "RESTAURANT"
  const waiting = line ? line.positions.filter((p) => !p.fulfilled) : []
  const waitingCount = waiting.length
  const waitingGuests = guestCount(waiting)
  const servedCount = line ? line.positions.length - waitingCount : 0
  // Don't offer party sizes that can't fit. When the owner hides capacity
  // (maxCapacity is null for us) the server still refuses parties that don't fit.
  const maxPartySize =
    line?.maxCapacity != null
      ? Math.max(1, Math.min(MAX_PARTY_SIZE, line.maxCapacity - line.capacityUsed))
      : MAX_PARTY_SIZE
  const joinPartySize = Math.min(partySize, maxPartySize)
  const hasProductInfo = !!(line?.productName || line?.productImage)

  // canJoin depends on the clock, but nothing re-rendered when opensAt or
  // closesAt passed, so people waiting on a drop had to refresh to see Join.
  const opensAtMs = line?.opensAt ? new Date(line.opensAt).getTime() : null
  const closesAtMs = line?.closesAt ? new Date(line.closesAt).getTime() : null
  const viewerId = session?.user?.id
  useEffect(() => {
    const nowMs = Date.now()
    const upcoming = [opensAtMs, closesAtMs].filter((t): t is number => t !== null && t > nowMs)
    if (upcoming.length === 0) return
    const boundary = Math.min(...upcoming)
    const delay = boundary - nowMs + 250
    if (delay > 2_147_000_000) return
    const timer = setTimeout(() => {
      setScheduleTick((t) => t + 1)
      const current = lineRef.current
      if (boundary !== opensAtMs || !current || current.createdBy.id === viewerId) return
      if (getMemberStatus(current, viewerId)) return
      sendNotification("The line is open", { body: `${current.name} is open. Join now.`, tag: `waitlyst-${lineId}` })
      addToast(`${current.name} is open. Join now!`, "success")
    }, delay)
    return () => clearTimeout(timer)
  }, [opensAtMs, closesAtMs, viewerId, lineId, sendNotification, addToast])

  /** Tell a party it no longer fits rather than joining them as a smaller one */
  function partyNoLongerFits(requested: number): void {
    setPartySize(maxPartySize)
    setPartySizeChosen(false)
    addToast(
      `A party of ${requested} no longer fits -- there's room for ${maxPartySize} more guest${maxPartySize === 1 ? "" : "s"}. Choose your party size and join again.`,
      "error"
    )
  }

  async function handleJoin(sizeOverride?: number): Promise<boolean> {
    if (sizeOverride === undefined && isRestaurant && partySizeChosen && partySize > maxPartySize) {
      partyNoLongerFits(partySize)
      return false
    }
    const size = sizeOverride ?? joinPartySize
    if (!session) {
      // Come back with ?join=1 so the join completes on return instead of
      // making them find and press "Join Line" a second time after sign-in.
      // The party size they picked rides along, or they'd join as the default.
      const party = line?.kind === "RESTAURANT" ? `&party=${size}` : ""
      signIn("google", { callbackUrl: `/lines/${lineId}?join=1${party}` })
      return false
    }

    setJoining(true)
    try {
      const res = await fetch(`/api/lines/${lineId}/join`, {
        method: "POST",
        ...(line?.kind === "RESTAURANT" && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partySize: size, ...(joinNote.trim() && { note: joinNote.trim() }) }),
        }),
      })
      if (res.ok) {
        refreshAll()
        return true
      }
      const data = await res.json()
      addToast(data.error || "Failed to join line", "error")
      return false
    } finally {
      setJoining(false)
    }
  }

  // Finish a join that was interrupted by the sign-in redirect. Ref guard so
  // a re-render while the request is in flight can't double-submit.
  const autoJoinAttempted = useRef(false)
  useEffect(() => {
    if (searchParams.get("join") !== "1" || !session || !line) return
    if (autoJoinAttempted.current) return
    autoJoinAttempted.current = true
    router.replace(`/lines/${lineId}`, { scroll: false })
    const party = Number(searchParams.get("party"))
    const requested = Number.isInteger(party) && party >= 1 ? party : undefined
    if (canJoin && requested && requested > maxPartySize) {
      // The line filled while they were signing in: eight people must not
      // turn up for a table booked for five
      partyNoLongerFits(requested)
      return
    }
    const size = requested
    if (size) {
      setPartySize(size)
      setPartySizeChosen(true)
    }
    if (canJoin) {
      handleJoin(size).then((joined) => {
        if (joined) addToast("You're in line!", "success")
      })
    } else if (!isInLine && !isCreator) {
      // Say why, rather than landing them back on the page with nothing done
      addToast(
        lineFull ? "The line filled up while you were signing in."
          : linePaused ? "The line was paused while you were signing in."
          : lineClosed ? "The line closed while you were signing in."
          : "You can't join this line right now.",
        "info"
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, session, line, canJoin])

  // Whether they asked to be emailed when this scheduled line opens
  useEffect(() => {
    if (!session || !lineNotYetOpen || isCreator || !line?.emailEnabled) return
    fetch(`/api/lines/${lineId}/remind`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setRemindMe(!!data?.subscribed))
      .catch(() => setRemindMe(false))
  }, [session, lineNotYetOpen, isCreator, lineId, line?.emailEnabled])

  async function toggleReminder(on = !remindMe) {
    setRemindBusy(true)
    try {
      const res = await fetch(`/api/lines/${lineId}/remind`, { method: on ? "POST" : "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setRemindMe(data.subscribed)
        addToast(data.subscribed ? "We'll email you when it opens" : "Reminder cancelled", "success")
      } else {
        addToast(data.error || "Couldn't update the reminder", "error")
      }
    } finally {
      setRemindBusy(false)
    }
  }

  // Finish "sign in to get an email" after the sign-in redirect
  const remindAttempted = useRef(false)
  useEffect(() => {
    if (searchParams.get("remind") !== "1" || !session || !line || remindAttempted.current) return
    remindAttempted.current = true
    router.replace(`/lines/${lineId}`, { scroll: false })
    if (lineNotYetOpen && !isCreator && line.emailEnabled) toggleReminder(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, session, line])

  async function handleRespond(response: "ON_MY_WAY" | "RUNNING_LATE") {
    const res = await fetch(`/api/lines/${lineId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    })
    if (res.ok) {
      addToast(response === "ON_MY_WAY" ? "Told the host you're on your way" : "Told the host you're running late", "success")
      refreshAll()
    } else {
      const data = await res.json().catch(() => ({}))
      addToast(data.error || "Couldn't send that to the host", "error")
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/lines/${lineId}`, { method: "DELETE" })
      if (res.ok) {
        addToast("Line deleted successfully", "success")
        router.push("/dashboard")
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to delete line", "error")
      }
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  async function handleSaveAnnouncement() {
    setSavingAnnouncement(true)
    try {
      const res = await fetch(`/api/lines/${lineId}/announcement`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announcement: announcementDraft.trim() || null }),
      })
      if (res.ok) {
        const data = await res.json()
        setLine(data)
        setShowAnnouncementEditor(false)
        addToast(announcementDraft.trim() ? "Announcement posted" : "Announcement cleared", "success")
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to update announcement", "error")
      }
    } finally {
      setSavingAnnouncement(false)
    }
  }

  async function handleClearAnnouncement() {
    setSavingAnnouncement(true)
    try {
      const res = await fetch(`/api/lines/${lineId}/announcement`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announcement: null }),
      })
      if (res.ok) {
        const data = await res.json()
        setLine(data)
        setShowAnnouncementEditor(false)
        setAnnouncementDraft("")
        addToast("Announcement cleared", "success")
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to clear announcement", "error")
      }
    } finally {
      setSavingAnnouncement(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-ink/10 w-1/3 mb-4"></div>
          <div className="h-4 bg-ink/10 w-2/3 mb-8"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-ink/10"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error || !line) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-ink/50">{error || "Line not found"}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <ConfirmModal
        open={showDeleteConfirm}
        title="Delete Line"
        message={`Delete "${line.name}"? Everyone in it is removed, any swap payment still on hold is refunded, and you lose access to its settlement page. Export it first if you need a record. This can't be undone.`}
        confirmLabel="Delete Line"
        variant="danger"
        isLoading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Product Hero */}
      {hasProductInfo && (
        <Card className="mb-6 overflow-hidden">
          <div className="flex flex-col sm:flex-row">
            {line.productImage && (
              <div className="relative w-full sm:w-48 h-48 sm:h-auto flex-shrink-0 bg-paper border-b sm:border-b-0 sm:border-r border-rule">
                <Image
                  src={line.productImage}
                  alt={line.productName || "Product"}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 100vw, 192px"
                  // Owners can link an image on any https host; the
                  // optimizer only accepts the hosts in next.config.ts.
                  unoptimized
                />
              </div>
            )}
            <div className="flex-1 p-5 flex flex-col justify-center">
              {line.productName && (
                <h2 className="text-xl font-semibold tracking-tight text-ink mb-1">
                  {line.productName}
                </h2>
              )}
              {line.productPrice != null && (
                <p className="text-base text-ink/60 mb-2">
                  Retail: <span className="font-mono tabular-nums text-ink">${line.productPrice.toFixed(2)}</span>
                </p>
              )}
              {line.productUrl && (
                <a
                  href={line.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4 transition-colors"
                >
                  View Product
                  <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 basis-60">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink mb-2 break-words">{line.name}</h1>
              {line.description && (
                <p className="text-ink/60">{line.description}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ShareLine lineId={line.id} lineName={line.name} />
              {canJoin && line.kind === "RESTAURANT" && (
                <label className="flex items-center gap-2 text-sm text-ink/60">
                  <span className="whitespace-nowrap">Party of</span>
                  <select
                    value={joinPartySize}
                    onChange={(e) => {
                      setPartySize(Number(e.target.value))
                      setPartySizeChosen(true)
                    }}
                    className="border border-rule bg-white px-2 py-2 text-ink"
                    aria-label="Party size"
                  >
                    {Array.from({ length: maxPartySize }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
              )}
              {canJoin && session && line.kind === "RESTAURANT" && (
                <input
                  value={joinNote}
                  onChange={(e) => setJoinNote(e.target.value)}
                  maxLength={140}
                  placeholder="Note for the host (optional)"
                  aria-label="Note for the host"
                  className="border border-rule bg-white px-2 py-2 text-sm text-ink placeholder:text-ink/30 w-48"
                />
              )}
              {canJoin && (
                <Button onClick={() => handleJoin()} isLoading={joining}>
                  {session ? "Join Line" : "Sign in to Join"}
                </Button>
              )}
              {!session && status !== "loading" && lineNotYetOpen && !linePaused && (
                <Button
                  variant="secondary"
                  onClick={() => signIn("google", { callbackUrl: line.emailEnabled ? `/lines/${lineId}?remind=1` : `/lines/${lineId}` })}
                >
                  {line.emailEnabled ? "Sign in to get an email when it opens" : "Sign in to get ready"}
                </Button>
              )}
              {line.emailEnabled && session && lineNotYetOpen && !isCreator && !isInLine && remindMe !== null && (
                <Button variant="secondary" onClick={() => toggleReminder()} isLoading={remindBusy}>
                  {remindMe ? "You'll get an email when it opens ✓" : "Email me when it opens"}
                </Button>
              )}
              {isCreator && (
                <>
                  <Link href={`/lines/${lineId}/edit`}>
                    <Button variant="secondary" size="sm">
                      Edit
                    </Button>
                  </Link>
                  <DropdownMenu
                    items={[
                      {
                        label: line.announcement ? "Edit Announcement" : "Announce",
                        onClick: () => {
                          setAnnouncementDraft(line.announcement || "")
                          setShowAnnouncementEditor(true)
                        },
                      },
                      {
                        label: "Export CSV",
                        onClick: () => {
                          const link = document.createElement("a")
                          link.href = `/api/lines/${lineId}/export`
                          link.download = ""
                          document.body.appendChild(link)
                          link.click()
                          document.body.removeChild(link)
                        },
                      },
                      { label: "Delete Line", onClick: () => setShowDeleteConfirm(true), variant: "danger" },
                    ]}
                    separatorBefore={[2]}
                  />
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-sm text-ink/50">
            <span>Created by</span>
            {line.createdBy.image ? (
              <Image
                src={line.createdBy.image}
                alt={line.createdBy.name || "Creator"}
                width={20}
                height={20}
                className="w-5 h-5 object-cover border border-rule"
              />
            ) : (
              <div className="w-5 h-5 bg-ink/10 border border-rule flex items-center justify-center text-xs text-ink/60">
                {line.createdBy.name?.[0] || "?"}
              </div>
            )}
            <span className="font-medium text-ink">
              {line.createdBy.name || "Anonymous"}
            </span>
          </div>
          </div>
          {!isCreator && (line.purchaseLimit || line.responseWindowMinutes) && (
            <p className="text-xs text-ink/50 mt-3">
              {line.purchaseLimit && <>Limit {line.purchaseLimit} per person. </>}
              {line.responseWindowMinutes && (
                <>When you&apos;re called, you have {line.responseWindowMinutes} min to show up, or your place goes to the next person.</>
              )}
            </p>
          )}
          {!isCreator && isRestaurant && (
            <p className="text-xs text-ink/50 mt-3">
              The host seats parties as tables free up, so a smaller party behind you may be seated first. You keep your place.
            </p>
          )}
          {!isCreator && (
            <p className="text-xs text-ink/50 mt-3">
              {line.allowResale ? (
                <>
                  You can buy the spot of the person directly ahead of you if they list it
                  {line.maxAskingPrice !== null && <> (for up to ${line.maxAskingPrice.toFixed(2)})</>}.
                  Buyers pay the asking price
                  {line.ownerFeePercent > 0 && <> + {line.ownerFeePercent}% to the line owner</>}
                  {line.platformFeePercent > 0 && <> + a {line.platformFeePercent}% Waitlyst fee</>}.{" "}
                  {isRestaurant
                    ? "Your card is held until you're seated. If you leave, or don't show up in time when you're called, it's charged anyway -- the guest you bought from gave up their place. The host can release it if they remove you."
                    : "Swaps are final and paid out to the seller right away."}
                </>
              ) : (
                "Spots on this line can't be bought or swapped."
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {isCreator && (
        <OwnerConsole
          lineId={line.id}
          isActive={line.isActive}
          nowServingUserId={line.nowServingUserId}
          ownerFeePercent={line.ownerFeePercent}
          positions={line.positions}
          stripeEnabled={stripeEnabled}
          hasPayoutSetup={hasPayoutSetup}
          justCreated={justCreated}
          onDismissCreated={() => setJustCreated(false)}
          onChanged={refreshAll}
          isRestaurant={isRestaurant}
          allowResale={line.allowResale}
          purchaseLimit={line.purchaseLimit}
        />
      )}

      {/* Paused Banner */}
      {linePaused && (
        <div className="mb-6">
          <div className="border border-rule border-l-2 border-l-amber-600 bg-white px-4 py-3">
            <div>
              <p className="font-semibold text-ink">This line is currently paused</p>
              <p className="text-sm text-ink/60 mt-0.5">
                {isCreator
                  ? "You have paused this line. No one can join or swap positions until you resume it."
                  : "New joins and position swaps are temporarily disabled."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Announcement Banner */}
      {line.announcement && !showAnnouncementEditor && (
        <div className="mb-6">
          <div className="border border-rule border-l-2 border-l-ink bg-white px-4 py-3">
            <div className="flex items-start space-x-3">
              <div className="flex-1 min-w-0">
                <p className="text-ink whitespace-pre-wrap break-words">{line.announcement}</p>
                {line.announcementAt && (
                  <p className="font-mono text-xs text-ink/40 mt-1">{timeAgo(line.announcementAt)}</p>
                )}
              </div>
              {isCreator && (
                <button
                  onClick={() => {
                    setAnnouncementDraft(line.announcement || "")
                    setShowAnnouncementEditor(true)
                  }}
                  className="text-ink/40 hover:text-ink flex-shrink-0"
                  title="Edit announcement"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Announcement Editor (owner only) */}
      {isCreator && showAnnouncementEditor && (
        <div className="mb-6">
          <div className="bg-white border border-ink p-4">
            <label className="block font-mono text-xs uppercase tracking-widest text-ink/50 mb-2">
              {line.announcement ? "Edit Announcement" : "New Announcement"}
            </label>
            <textarea
              value={announcementDraft}
              onChange={(e) => setAnnouncementDraft(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="Share an update with everyone in line..."
              className="w-full px-3 py-2 border border-rule text-sm focus:outline-none focus:border-ink placeholder:text-ink/30 resize-none"
            />
            <div className="flex items-center justify-between mt-2">
              <span className={`font-mono text-xs tabular-nums ${announcementDraft.length > 260 ? "text-amber-600" : "text-ink/40"}`}>
                {announcementDraft.length}/280
              </span>
              <div className="flex items-center gap-2">
                {line.announcement && (
                  <button
                    onClick={handleClearAnnouncement}
                    disabled={savingAnnouncement}
                    className="px-3 py-1.5 text-xs text-accent hover:bg-accent/5 transition-colors disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowAnnouncementEditor(false)
                    setAnnouncementDraft("")
                  }}
                  disabled={savingAnnouncement}
                  className="px-3 py-1.5 text-xs text-ink/60 hover:bg-ink/5 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveAnnouncement}
                  disabled={savingAnnouncement || announcementDraft.trim().length === 0}
                  className="px-3 py-1.5 text-xs font-medium text-paper bg-ink hover:bg-accent transition-colors disabled:opacity-50"
                >
                  {savingAnnouncement ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Now Serving Banner */}
      {line.nowServing && (
        <div className="mb-6">
          <div className="border border-rule border-l-2 border-l-green-700 bg-white px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-lg font-semibold tracking-tight text-ink">
                Now Serving: {line.nowServing}
              </p>
              {line.nowServingAt && (
                <p className="text-sm text-ink/50 mt-0.5">
                  Called {timeAgo(line.nowServingAt)}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status Banner */}
      {(line.opensAt || line.closesAt || line.hasCapacityLimit) && (
        <div className="mb-6">
          <LineStatusBanner
            opensAt={line.opensAt}
            closesAt={line.closesAt}
            maxCapacity={line.maxCapacity}
            currentCount={line.capacityUsed}
            isFull={line.isFull}
            kind={line.kind}
            hideCapacity={line.hasCapacityLimit && line.maxCapacity === null}
          />
        </div>
      )}

      {/* My Status Card — only for authenticated members in the line */}
      {memberStatus && userPosition && (
        <MemberStatusCard
          status={memberStatus}
          maxCapacity={isRestaurant ? null : line.maxCapacity}
          isRestaurant={isRestaurant}
          totalPositions={line.positions.length}
          askingPrice={userPosition.askingPrice}
          lineId={line.id}
          hideCapacity={!isCreator && line.hideCapacity}
          isPaused={linePaused}
          calledAt={userPosition?.calledAt ?? null}
          quotedMinutes={userPosition.quotedMinutes ?? null}
          quotedAt={userPosition.quotedAt ?? null}
          response={userPosition.response ?? null}
          respondedAt={userPosition.respondedAt ?? null}
          graceMinutes={userPosition.graceMinutes ?? 0}
          responseWindowMinutes={line.responseWindowMinutes}
          purchaseLimit={line.purchaseLimit}
          onRespond={handleRespond}
          notificationPermission={notificationPermission}
          onEnableNotifications={enableNotifications}
        />
      )}

      {!memberStatus && departure && (
        <Card className={`mb-6 border-l-2 ${departure.wasServed ? "border-l-green-700" : "border-l-amber-600"}`}>
          <div className="px-5 py-4 sm:px-6 flex items-start justify-between gap-4" role="status">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-ink/50">Your place</p>
              <p className="text-xl font-semibold tracking-tight text-ink mt-1">
                {departure.wasServed ? "You're all done here" : "You're no longer in this line"}
              </p>
              <p className="text-sm text-ink/60 mt-1">
                {departure.wasServed
                  ? "The organizer served you and cleared your spot. Thanks for waiting."
                  : departure.wasCalled
                    ? "You were called but didn't show up in time, so your place went to the next party -- or the organizer removed you."
                    : "You left from another device, or the organizer removed you."}
              </p>
              {canJoin && (
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => handleJoin()} isLoading={joining}>
                  Rejoin at the back
                </Button>
              )}
            </div>
            <button
              onClick={() => setDeparture(null)}
              className="text-ink/40 hover:text-ink flex-shrink-0"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Queue ({waitingCount} {isRestaurant
                ? `${waitingCount === 1 ? "party" : "parties"}, ${waitingGuests} ${waitingGuests === 1 ? "guest" : "guests"}`
                : waitingCount === 1 ? "person" : "people"} waiting
              {servedCount > 0 && `, ${servedCount} ${isRestaurant ? "seated" : "served"}`})
            </h2>
            {line.hasCapacityLimit && (
              <div className="flex items-center gap-3">
                {line.maxCapacity !== null ? (
                  <span className="font-mono text-xs uppercase tracking-widest text-ink/40 tabular-nums">
                    {line.capacityUsed} of {line.maxCapacity} {capacityUnit(line.kind, line.maxCapacity)} filled
                  </span>
                ) : (
                  <span className="font-mono text-xs uppercase tracking-widest text-ink/40">
                    Limited {capacityUnit(line.kind, 2)} available
                  </span>
                )}
                {userPosition && line.maxCapacity !== null && !isRestaurant && (
                  userPosition.position <= line.maxCapacity ? (
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-green-700">
                      <span className="w-1.5 h-1.5 bg-green-600" aria-hidden />
                      Your spot is secured
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-amber-600">
                      <span className="w-1.5 h-1.5 bg-amber-600" aria-hidden />
                      You&apos;re on the waitlist (#{userPosition.position - line.maxCapacity} past capacity)
                    </span>
                  )
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <QueueDisplay
            lineId={line.id}
            positions={line.positions}
            onRefresh={refreshAll}
            isCreator={isCreator}
            feeInfo={feeInfo}
            isPaused={linePaused}
            hasPayoutSetup={hasPayoutSetup}
            stripeEnabled={stripeEnabled}
            allowResale={line.allowResale}
            maxAskingPrice={line.maxAskingPrice}
            hideCapacity={!isCreator && line.hideCapacity}
            nowServingUserId={line.nowServingUserId}
            isRestaurant={isRestaurant}
            emailEnabled={line.emailEnabled}
            onLeft={() => { leftHereRef.current = true }}
            responseWindowMinutes={line.responseWindowMinutes}
          />
        </CardContent>
      </Card>

      {/* Activity Feed */}
      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Activity</h2>
        </CardHeader>
        <CardContent>
          {activitiesLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-ink/5 animate-pulse" />
              ))}
            </div>
          ) : activities.length === 0 ? (
            <p className="text-sm text-ink/40 text-center py-4">No activity yet</p>
          ) : (
            <>
              <div className="divide-y divide-rule">
                {(showAllActivity ? activities : activities.slice(0, 5)).map((activity) => {
                  const dotStyles: Record<string, string> = {
                    join: "bg-ink/30",
                    purchase: "bg-accent",
                    sale: "bg-green-600",
                    refund: "bg-amber-600",
                  }
                  const dot = dotStyles[activity.type] || dotStyles.join

                  return (
                    <div
                      key={activity.id}
                      className="flex items-center gap-2.5 py-2"
                    >
                      <span className={`w-1.5 h-1.5 flex-shrink-0 ${dot}`} aria-hidden />
                      <p className="text-xs text-ink/70 flex-1 min-w-0 truncate">
                        {activity.description}
                      </p>
                      <span className="font-mono text-xs text-ink/40 flex-shrink-0">
                        {timeAgo(activity.timestamp)}
                      </span>
                    </div>
                  )
                })}
              </div>
              {activities.length > 5 && (
                <button
                  onClick={() => setShowAllActivity(!showAllActivity)}
                  className="mt-2 font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
                >
                  {showAllActivity ? "Show less" : `Show more (${activities.length - 5} more)`}
                </button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
