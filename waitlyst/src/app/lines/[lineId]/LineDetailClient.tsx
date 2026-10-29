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
import { MemberStatusCard } from "@/components/MemberStatusCard"
import { timeAgo } from "@/lib/format"

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
  maxCapacity: number | null
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
  nowServingAt: string | null
  hideCapacity: boolean
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
    user: {
      id: string
      name: string | null
      image: string | null
    }
  }[]
}

export function LineDetailClient({ lineId }: { lineId: string }) {
  const { data: session, status } = useSession()
  const [line, setLine] = useState<Line | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAnnouncementEditor, setShowAnnouncementEditor] = useState(false)
  const [announcementDraft, setAnnouncementDraft] = useState("")
  const [savingAnnouncement, setSavingAnnouncement] = useState(false)
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(true)
  const [showAllActivity, setShowAllActivity] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)
  const [qrSvg, setQrSvg] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [hasPayoutSetup, setHasPayoutSetup] = useState(false)
  const [stripeEnabled, setStripeEnabled] = useState(false)
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { requestPermission, sendNotification } = useNotifications()
  const { addToast } = useToast()

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
      router.replace(`/lines/${lineId}`, { scroll: false })
    } else if (paymentStatus === "error") {
      const reason = searchParams.get("reason")
      const messages: Record<string, string> = {
        missing_session: "Payment session not found.",
        stripe_not_configured: "Payment system is not configured.",
        not_paid: "Payment was not completed.",
        no_transaction: "Transaction could not be found.",
        invalid_transaction: "Invalid transaction.",
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
      setNotificationsEnabled(Notification.permission === "granted")
    }
  }, [])

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

  const handleLineUpdate = useCallback((event: LineUpdateEvent) => {
    if (event.type === "poll-update" && event.data) {
      // Poll detected a change — use the fresh data directly (no extra fetch)
      setLine(event.data as Line)
      fetchActivity()
      return
    }

    // SSE event — refetch and notify
    fetchLine()
    fetchActivity()

    const messages: Record<string, string> = {
      join: `${event.userName || "Someone"} joined the line`,
      leave: `${event.userName || "Someone"} left the line — you may have moved up!`,
      swap: "Positions were swapped!",
      lock: "A position purchase is pending...",
      "price-change": `${event.userName || "Someone"} changed their price`,
      delete: "This line has been deleted",
    }
    const message = messages[event.type]
    if (message) {
      sendNotification(`Waitlyst - ${line?.name || "Line Update"}`, { body: message })
    }
  }, [fetchLine, fetchActivity, sendNotification, line?.name])

  // Subscribe to real-time updates
  useLineUpdates(lineId, handleLineUpdate)

  const isInLine = line?.positions.some((p) => p.user.id === session?.user?.id)
  const isCreator = line?.createdBy.id === session?.user?.id

  const now = new Date()
  const linePaused = line ? !line.isActive : false
  const lineNotYetOpen = line?.opensAt && now < new Date(line.opensAt)
  const lineClosed = line?.closesAt && now > new Date(line.closesAt)
  const lineFull = line?.maxCapacity ? line.positions.length >= line.maxCapacity : false
  const canJoin = !isInLine && !isCreator && !lineNotYetOpen && !lineClosed && !lineFull && !linePaused
  const userPosition = line?.positions.find((p) => p.user.id === session?.user?.id)
  const hasProductInfo = !!(line?.productName || line?.productImage)

  async function handleJoin(): Promise<boolean> {
    if (!session) {
      // Come back with ?join=1 so the join completes on return instead of
      // making them find and press "Join Line" a second time after sign-in.
      signIn("google", { callbackUrl: `/lines/${lineId}?join=1` })
      return false
    }

    setJoining(true)
    try {
      const res = await fetch(`/api/lines/${lineId}/join`, {
        method: "POST",
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
    if (canJoin) {
      handleJoin().then((joined) => {
        if (joined) addToast("You're in line!", "success")
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, session, line, canJoin])

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
        message={`Are you sure you want to delete "${line.name}"? This will remove all positions and transaction history. This action cannot be undone.`}
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
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink mb-2">{line.name}</h1>
              {line.description && (
                <p className="text-ink/60">{line.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <ShareLine lineId={line.id} lineName={line.name} />
              {canJoin && (
                <Button onClick={handleJoin} isLoading={joining}>
                  {session ? "Join Line" : "Sign in to Join"}
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
          {session && (
            <button
              onClick={async () => {
                const result = await requestPermission()
                setNotificationsEnabled(result === "granted")
              }}
              className={`flex items-center gap-2 px-3 py-1.5 font-mono text-xs uppercase tracking-widest border transition-colors ${
                notificationsEnabled
                  ? "border-rule text-green-700"
                  : "border-rule text-ink/60 hover:text-ink hover:border-ink"
              }`}
            >
              <span className={`w-1.5 h-1.5 flex-shrink-0 ${notificationsEnabled ? "bg-green-600" : "bg-ink/30"}`} aria-hidden />
              <span>{notificationsEnabled ? "Notifications On" : "Enable Notifications"}</span>
            </button>
          )}
          </div>
        </CardContent>
      </Card>

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
      {(line.opensAt || line.closesAt || line.maxCapacity) && (
        <div className="mb-6">
          <LineStatusBanner
            opensAt={line.opensAt}
            closesAt={line.closesAt}
            maxCapacity={line.maxCapacity}
            currentCount={line.positions.length}
            hideCapacity={!isCreator && line.hideCapacity}
          />
        </div>
      )}

      {/* My Status Card — only for authenticated members in the line */}
      {isInLine && userPosition && (
        <MemberStatusCard
          position={userPosition.position}
          maxCapacity={line.maxCapacity}
          totalPositions={line.positions.length}
          askingPrice={userPosition.askingPrice}
          lineId={line.id}
          hideCapacity={!isCreator && line.hideCapacity}
        />
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Queue ({line.positions.length} {line.positions.length === 1 ? "person" : "people"})
            </h2>
            {line.maxCapacity != null && (
              <div className="flex items-center gap-3">
                {(!line.hideCapacity || isCreator) ? (
                  <span className="font-mono text-xs uppercase tracking-widest text-ink/40 tabular-nums">
                    {line.positions.length} of {line.maxCapacity} spots filled
                  </span>
                ) : (
                  <span className="font-mono text-xs uppercase tracking-widest text-ink/40">
                    Limited spots available
                  </span>
                )}
                {userPosition && (
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
