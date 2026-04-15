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
    user: {
      id: string
      name: string | null
      image: string | null
    }
  }[]
}

interface MarketData {
  avgPrice: number
  minPrice: number
  maxPrice: number
  volume: number
  count: number
  currentListings: number
  lowestAsk: number | null
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
  const [marketData, setMarketData] = useState<MarketData | null>(null)
  const [showQrModal, setShowQrModal] = useState(false)
  const [qrSvg, setQrSvg] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [hasPayoutSetup, setHasPayoutSetup] = useState(false)
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

  // Fetch market data
  const fetchMarketData = useCallback(async () => {
    try {
      const res = await fetch(`/api/lines/${lineId}/market`)
      if (res.ok) {
        const data = await res.json()
        setMarketData(data)
      }
    } catch {
      // Market data is non-critical
    }
  }, [lineId])

  useEffect(() => {
    fetchMarketData()
  }, [fetchMarketData])

  const handleLineUpdate = useCallback((event: LineUpdateEvent) => {
    if (event.type === "poll-update" && event.data) {
      // Poll detected a change — use the fresh data directly (no extra fetch)
      setLine(event.data as Line)
      fetchActivity()
      fetchMarketData()
      return
    }

    // SSE event — refetch and notify
    fetchLine()
    fetchActivity()
    fetchMarketData()

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
  }, [fetchLine, fetchActivity, fetchMarketData, sendNotification, line?.name])

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
  const hasMarketData = marketData && (marketData.count > 0 || marketData.currentListings > 0)

  async function handleJoin() {
    if (!session) {
      signIn("google")
      return
    }

    setJoining(true)
    try {
      const res = await fetch(`/api/lines/${lineId}/join`, {
        method: "POST",
      })
      if (res.ok) {
        fetchLine()
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to join line", "error")
      }
    } finally {
      setJoining(false)
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
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3 mb-8"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
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
            <p className="text-gray-500">{error || "Line not found"}</p>
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
              <div className="relative w-full sm:w-48 h-48 sm:h-auto flex-shrink-0 bg-gray-100">
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
                <h2 className="text-xl font-bold text-gray-900 mb-1">
                  {line.productName}
                </h2>
              )}
              {line.productPrice != null && (
                <p className="text-base text-gray-600 mb-2">
                  Retail: <span className="font-semibold">${line.productPrice.toFixed(2)}</span>
                </p>
              )}
              {line.productUrl && (
                <a
                  href={line.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
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

      {/* Market Data Strip */}
      {hasMarketData && (
        <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
            <span className="font-medium text-gray-500 text-xs uppercase tracking-wide">Market</span>
            {marketData.count > 0 && (
              <>
                <span>
                  Avg: <span className="font-semibold text-gray-800">${marketData.avgPrice.toFixed(2)}</span>
                </span>
                <span className="text-gray-300">|</span>
                <span>
                  Range: <span className="font-semibold text-gray-800">${marketData.minPrice.toFixed(2)}&ndash;${marketData.maxPrice.toFixed(2)}</span>
                </span>
              </>
            )}
            {marketData.currentListings > 0 && (
              <>
                {marketData.count > 0 && <span className="text-gray-300">|</span>}
                <span>
                  <span className="font-semibold text-gray-800">{marketData.currentListings}</span> listing{marketData.currentListings !== 1 ? "s" : ""}
                </span>
              </>
            )}
            {marketData.lowestAsk != null && (
              <>
                <span className="text-gray-300">|</span>
                <span>
                  Lowest ask: <span className="font-semibold text-gray-800">${marketData.lowestAsk.toFixed(2)}</span>
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{line.name}</h1>
              {line.description && (
                <p className="text-gray-600">{line.description}</p>
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
          <div className="flex items-center space-x-2 text-sm text-gray-500">
            <span>Created by</span>
            {line.createdBy.image ? (
              <Image
                src={line.createdBy.image}
                alt={line.createdBy.name || "Creator"}
                width={20}
                height={20}
                className="rounded-full"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center text-xs">
                {line.createdBy.name?.[0] || "?"}
              </div>
            )}
            <span className="font-medium text-gray-700">
              {line.createdBy.name || "Anonymous"}
            </span>
          </div>
          {session && (
            <button
              onClick={async () => {
                const result = await requestPermission()
                setNotificationsEnabled(result === "granted")
              }}
              className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                notificationsEnabled
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span>{notificationsEnabled ? "Notifications On" : "Enable Notifications"}</span>
            </button>
          )}
          </div>
        </CardContent>
      </Card>

      {/* Paused Banner */}
      {linePaused && (
        <div className="mb-6">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-semibold text-amber-800">This line is currently paused</p>
                <p className="text-sm text-amber-600">
                  {isCreator
                    ? "You have paused this line. No one can join or buy positions until you resume it."
                    : "New joins and position purchases are temporarily disabled."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Announcement Banner */}
      {line.announcement && !showAnnouncementEditor && (
        <div className="mb-6">
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <svg className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-indigo-900 whitespace-pre-wrap break-words">{line.announcement}</p>
                {line.announcementAt && (
                  <p className="text-xs text-indigo-500 mt-1">{timeAgo(line.announcementAt)}</p>
                )}
              </div>
              {isCreator && (
                <button
                  onClick={() => {
                    setAnnouncementDraft(line.announcement || "")
                    setShowAnnouncementEditor(true)
                  }}
                  className="text-indigo-400 hover:text-indigo-600 flex-shrink-0"
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
          <div className="bg-white border border-indigo-200 rounded-lg p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {line.announcement ? "Edit Announcement" : "New Announcement"}
            </label>
            <textarea
              value={announcementDraft}
              onChange={(e) => setAnnouncementDraft(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="Share an update with everyone in line..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
            />
            <div className="flex items-center justify-between mt-2">
              <span className={`text-xs ${announcementDraft.length > 260 ? "text-amber-600" : "text-gray-400"}`}>
                {announcementDraft.length}/280
              </span>
              <div className="flex items-center gap-2">
                {line.announcement && (
                  <button
                    onClick={handleClearAnnouncement}
                    disabled={savingAnnouncement}
                    className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
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
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveAnnouncement}
                  disabled={savingAnnouncement || announcementDraft.trim().length === 0}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
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
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <span className="text-2xl flex-shrink-0" role="img" aria-label="bell">&#x1F514;</span>
              <div className="flex-1 min-w-0">
                <p className="text-lg font-bold text-emerald-900">
                  Now Serving: {line.nowServing}
                </p>
                {line.nowServingAt && (
                  <p className="text-sm text-emerald-600 mt-0.5">
                    Called {timeAgo(line.nowServingAt)}
                  </p>
                )}
              </div>
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
            <h2 className="text-lg font-semibold text-gray-900">
              Queue ({line.positions.length} {line.positions.length === 1 ? "person" : "people"})
            </h2>
            {line.maxCapacity != null && (
              <div className="flex items-center gap-3">
                {(!line.hideCapacity || isCreator) ? (
                  <span className="text-sm text-gray-500">
                    {line.positions.length} of {line.maxCapacity} spots filled
                  </span>
                ) : (
                  <span className="text-sm text-gray-500">
                    Limited spots available
                  </span>
                )}
                {userPosition && (
                  userPosition.position <= line.maxCapacity ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Your spot is secured
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
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
            onRefresh={fetchLine}
            isCreator={isCreator}
            feeInfo={feeInfo}
            isPaused={linePaused}
            hasPayoutSetup={hasPayoutSetup}
            allowResale={line.allowResale}
            maxAskingPrice={line.maxAskingPrice}
            hideCapacity={!isCreator && line.hideCapacity}
          />
        </CardContent>
      </Card>

      {/* Activity Feed */}
      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-lg font-semibold text-gray-900">Activity</h2>
        </CardHeader>
        <CardContent>
          {activitiesLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : activities.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No activity yet</p>
          ) : (
            <>
              <div className="space-y-1.5">
                {(showAllActivity ? activities : activities.slice(0, 5)).map((activity) => {
                  const iconStyles: Record<string, { bg: string; icon: string; path: string }> = {
                    join: {
                      bg: "bg-blue-100",
                      icon: "text-blue-600",
                      path: "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z",
                    },
                    purchase: {
                      bg: "bg-red-100",
                      icon: "text-red-600",
                      path: "M5 10l7-7m0 0l7 7m-7-7v18",
                    },
                    sale: {
                      bg: "bg-green-100",
                      icon: "text-green-600",
                      path: "M19 14l-7 7m0 0l-7-7m7 7V3",
                    },
                    refund: {
                      bg: "bg-amber-100",
                      icon: "text-amber-600",
                      path: "M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6",
                    },
                  }
                  const style = iconStyles[activity.type] || iconStyles.join

                  return (
                    <div
                      key={activity.id}
                      className="flex items-center gap-2.5 py-1.5"
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${style.bg}`}>
                        <svg className={`w-3 h-3 ${style.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={style.path} />
                        </svg>
                      </div>
                      <p className="text-xs text-gray-700 flex-1 min-w-0 truncate">
                        {activity.description}
                      </p>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {timeAgo(activity.timestamp)}
                      </span>
                    </div>
                  )
                })}
              </div>
              {activities.length > 5 && (
                <button
                  onClick={() => setShowAllActivity(!showAllActivity)}
                  className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
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
