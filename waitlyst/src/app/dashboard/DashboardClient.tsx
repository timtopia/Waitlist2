"use client"

import Link from "next/link"
import { useDialog } from "@/lib/use-dialog"
import { useRouter } from "next/navigation"
import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { buttonClasses } from "@/components/ui/buttonStyles"
import { Input } from "@/components/ui/Input"
import { ConfirmModal } from "@/components/ui/ConfirmModal"
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/DropdownMenu"
import { useToast } from "@/components/ui/Toast"
import { timeAgo, formatCurrency, formatDateTime } from "@/lib/format"
import { formatWaitTime } from "@/lib/wait-time"
import type { MemberPhase } from "@/lib/member-status"

interface CreatedLine {
  id: string
  name: string
  description: string | null
  isActive: boolean
  isPublic: boolean
  createdAt: string
  kind?: "STANDARD" | "RESTAURANT"
  opensAt?: string | null
  closesAt?: string | null
  maxCapacity?: number | null
  /** Spots (or seats) taken against maxCapacity, served drop buyers included */
  capacityUsed?: number | null
  _count: { positions: number }
  frontPerson: {
    id: string
    position: number
    calledAt: string | null
    user: { id: string; name: string | null }
  } | null
}

interface Position {
  id: string
  lineId: string
  position: number
  askingPrice: string | null
  joinedAt: string
  ahead: number
  phase: MemberPhase
  line: {
    name: string
    isActive: boolean
    createdAt: string
    kind?: "STANDARD" | "RESTAURANT"
    _count: { positions: number }
  }
}

const phaseLabel: Record<MemberPhase, { text: (ahead: number, restaurant: boolean) => string; className: string }> = {
  called: {
    text: (_, restaurant) => (restaurant ? "Your table is ready. Head to the host stand" : "Your turn. Head to the front"),
    className: "text-accent font-semibold",
  },
  next: { text: () => "You're next", className: "text-green-700" },
  served: { text: (_, restaurant) => (restaurant ? "Seated" : "Served"), className: "text-green-700" },
  waiting: {
    text: (ahead, restaurant) => `${ahead} ${restaurant ? (ahead === 1 ? "party" : "parties") + " " : ""}ahead of you`,
    className: "text-ink/60",
  },
}

type StatusFilter = "all" | "active" | "paused" | "closed"

/** A drop whose closing time passed is still isActive, but nobody can join */
const isClosedBySchedule = (l: { closesAt?: string | null }) => !!l.closesAt && new Date(l.closesAt) <= new Date()
type SortOption = "newest" | "oldest" | "most-members"

interface LineStats {
  ownerFeeEarned?: number
  ownerFeePending?: number
  ownerFeeAwaitingPayout?: number
  kind?: "STANDARD" | "RESTAURANT"
  ownerFeePercent?: number
  totalTransactions: number
  completedCount: number
  refundedCount: number
  pendingSettlementCount: number
  totalCompleted: number
  totalRefunded: number
  pendingSettlement: number
  netRevenue: number
  service?: {
    served: number
    left: number
    removed: number
    waiting: number
    medianWaitMinutes: number | null
    servedLastHour: number
  }
}

interface StatsModal {
  lineId: string
  lineName: string
  stats: LineStats | null
  loading: boolean
  /** The request failed: not the same as "no sales yet" */
  failed?: boolean
}

interface DashboardClientProps {
  createdLines: CreatedLine[]
  positions: Position[]
  isNewUser?: boolean
}

interface Activity {
  id: string
  type: "joined" | "purchase" | "sale" | "refund" | "served" | "left" | "removed" | "offer"
  description: string
  amount?: number
  lineId?: string
  lineName?: string
  createdAt: string
}

export function DashboardClient({ createdLines: initialLines, positions, isNewUser }: DashboardClientProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const [lines, setLines] = useState(initialLines)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [statsModal, setStatsModal] = useState<StatsModal | null>(null)
  const statsDialogRef = useDialog(!!statsModal, () => setStatsModal(null))
  const statsTitleRef = useRef<HTMLHeadingElement>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ lineId: string; lineName: string } | null>(null)
  const [removeConfirm, setRemoveConfirm] = useState<{ lineId: string; positionId: string; name: string } | null>(null)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)

  // Check localStorage for dismissed onboarding
  useEffect(() => {
    if (typeof window !== "undefined") {
      setOnboardingDismissed(localStorage.getItem("waitlyst_onboarding_dismissed") === "true")
    }
  }, [])

  function dismissOnboarding() {
    setOnboardingDismissed(true)
    localStorage.setItem("waitlyst_onboarding_dismissed", "true")
  }

  // Search, filter, and sort state
  const [searchText, setSearchText] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [createdSort, setCreatedSort] = useState<SortOption>("newest")
  const [positionsSort, setPositionsSort] = useState<SortOption>("newest")
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Computed: filter counts for "Lines I Created"
  const statusCounts = useMemo(() => {
    const searchLower = searchText.toLowerCase()
    const searchFiltered = searchText
      ? lines.filter(l => l.name.toLowerCase().includes(searchLower))
      : lines
    return {
      all: searchFiltered.length,
      active: searchFiltered.filter(l => l.isActive && !isClosedBySchedule(l)).length,
      paused: searchFiltered.filter(l => !l.isActive).length,
      closed: searchFiltered.filter(l => l.isActive && isClosedBySchedule(l)).length,
    }
  }, [lines, searchText])

  // Computed: filtered and sorted "Lines I Created"
  const filteredLines = useMemo(() => {
    const searchLower = searchText.toLowerCase()
    let result = lines

    // Text search
    if (searchText) {
      result = result.filter(l => l.name.toLowerCase().includes(searchLower))
    }

    // Status filter
    if (statusFilter === "active") {
      result = result.filter(l => l.isActive && !isClosedBySchedule(l))
    } else if (statusFilter === "paused") {
      result = result.filter(l => !l.isActive)
    } else if (statusFilter === "closed") {
      result = result.filter(l => l.isActive && isClosedBySchedule(l))
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (createdSort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (createdSort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      return b._count.positions - a._count.positions // most-members
    })

    return result
  }, [lines, searchText, statusFilter, createdSort])

  // Computed: filtered and sorted "My Positions"
  const filteredPositions = useMemo(() => {
    const searchLower = searchText.toLowerCase()
    let result = positions

    // Text search
    if (searchText) {
      result = result.filter(p => p.line.name.toLowerCase().includes(searchLower))
    }

    // Sort, but always surface a line that's calling you right now
    result = [...result].sort((a, b) => {
      const calledFirst = Number(b.phase === "called") - Number(a.phase === "called")
      if (calledFirst !== 0) return calledFirst
      // Last week's ✓ shouldn't sit above a line they're waiting in now
      const servedLast = Number(a.phase === "served") - Number(b.phase === "served")
      if (servedLast !== 0) return servedLast
      if (positionsSort === "newest") return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime()
      if (positionsSort === "oldest") return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
      return b.line._count.positions - a.line._count.positions // most-members
    })

    return result
  }, [positions, searchText, positionsSort])

  // Activity Feed
  const [activities, setActivities] = useState<Activity[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(true)
  // The first load failed: "No recent activity" would tell someone checking
  // on a sale or refund that nothing happened
  const [activitiesFailed, setActivitiesFailed] = useState(false)

  // Refetched with the dashboard poll below: router.refresh() doesn't re-run
  // this client fetch, so a sale or refund that lands while the tab sits open
  // (or in the background) would otherwise never show up
  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch("/api/activity", { cache: "no-store" })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          setActivities(data)
          setActivitiesFailed(false)
        }
      } else {
        setActivitiesFailed(true)
      }
    } catch {
      // Offline: keep showing the last feed (and say so if there is none)
      setActivitiesFailed(true)
    } finally {
      setActivitiesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  // Poll for dashboard updates — only when tab is visible, every 60 seconds
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null

    function start() {
      if (!interval) {
        interval = setInterval(() => {
          if (document.visibilityState === "visible") {
            router.refresh()
            fetchActivities()
          }
        }, 60000)
      }
    }

    function stop() {
      if (interval) { clearInterval(interval); interval = null }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        router.refresh() // Immediate refresh when tab comes back
        fetchActivities()
        start()
      } else {
        stop()
      }
    }

    document.addEventListener("visibilitychange", onVisibility)
    start()

    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      stop()
    }
  }, [router, fetchActivities])

  // Sync lines state when server data changes
  useEffect(() => {
    setLines(initialLines)
  }, [initialLines])

  async function handleCallNext(lineId: string, positionId: string) {
    setLoadingAction(`call-${lineId}`)
    try {
      // Name who the card showed: this page refreshes slowly, and a queue
      // that moved since shouldn't make this call someone else
      const res = await fetch(`/api/lines/${lineId}/call-next`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId }),
      })
      if (res.ok) {
        const data = await res.json()
        addToast(`Called ${data.calledUser} to the front!`, "success")
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        addToast(data.error || "Failed to call next person", "error")
      }
    } catch {
      addToast("No connection -- that didn't go through. Try again.", "error")
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleServeFront(lineId: string, positionId: string, name: string, servedWord: string) {
    setLoadingAction(`serve-${lineId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/fulfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId }),
      })
      if (res.ok) {
        addToast(`${name} marked as ${servedWord}`, "success")
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        addToast(data.error || `Failed to mark as ${servedWord}`, "error")
      }
    } catch {
      addToast("No connection -- that didn't go through. Try again.", "error")
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleRemoveFront(lineId: string, positionId: string, name: string) {
    setRemoveConfirm(null)
    setLoadingAction(`remove-${lineId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/remove-front`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId }),
      })
      if (res.ok) {
        addToast(`${name} removed from the line`, "success")
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        addToast(data.error || "Failed to remove person", "error")
      }
    } catch {
      addToast("No connection -- that didn't go through. Try again.", "error")
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleDuplicateLine(lineId: string) {
    setLoadingAction(`duplicate-${lineId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/duplicate`, {
        method: "POST",
      })
      if (res.ok) {
        const newLine = await res.json()
        addToast("Line duplicated. It starts paused -- resume it when it's ready.", "success")
        router.push(`/lines/${newLine.id}/edit`)
      } else {
        const data = await res.json().catch(() => ({}))
        addToast(data.error || "Failed to duplicate line", "error")
      }
    } catch {
      addToast("No connection -- that didn't go through. Try again.", "error")
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleDeleteLine(lineId: string) {
    setDeleteConfirm(null)
    setLoadingAction(`delete-${lineId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}`, {
        method: "DELETE",
      })
      if (res.ok) {
        setLines(lines.filter(l => l.id !== lineId))
        addToast("Line deleted", "success")
      } else if (res.status === 404) {
        // Deleted on another device: drop the stale card instead of failing every retry
        setLines((prev) => prev.filter((l) => l.id !== lineId))
        addToast("That line was already deleted.", "info")
      } else {
        // A refund failed: the server kept the line but paused it
        if (res.status === 409) {
          setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, isActive: false } : l)))
          router.refresh()
        }
        const data = await res.json().catch(() => ({}))
        addToast(data.error || "Failed to delete line", "error")
      }
    } catch {
      addToast("No connection -- that didn't go through. Try again.", "error")
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleTogglePause(lineId: string) {
    setLoadingAction(`pause-${lineId}`)
    const current = lines.find((l) => l.id === lineId)
    try {
      const res = await fetch(`/api/lines/${lineId}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !current?.isActive }),
      })
      if (res.ok) {
        const data = await res.json()
        setLines(lines.map(l =>
          l.id === lineId ? { ...l, isActive: data.isActive } : l
        ))
        addToast(data.isActive ? "Line resumed" : "Line paused", "success")
      } else {
        const data = await res.json().catch(() => ({}))
        addToast(data.error || "Failed to update", "error")
      }
    } catch {
      addToast("No connection -- that didn't go through. Try again.", "error")
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleTogglePublic(lineId: string, currentlyPublic: boolean) {
    setLoadingAction(`toggle-${lineId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: !currentlyPublic }),
      })
      if (res.ok) {
        setLines(lines.map(l =>
          l.id === lineId ? { ...l, isPublic: !currentlyPublic } : l
        ))
        addToast(`Line is now ${!currentlyPublic ? "public" : "private"}`, "success")
      } else {
        const data = await res.json().catch(() => ({}))
        addToast(data.error || "Failed to update", "error")
      }
    } catch {
      addToast("No connection -- that didn't go through. Try again.", "error")
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleCopyLink(lineId: string) {
    const url = `${window.location.origin}/lines/${lineId}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Blocked clipboard (permissions, older browsers) used to still say "copied"
      addToast(`Couldn't copy automatically. The link is ${url}`, "error")
      return
    }
    setCopiedId(lineId)
    addToast("Link copied to clipboard!", "success")
    setTimeout(() => setCopiedId(null), 2000)
  }

  async function openStatsModal(lineId: string, lineName: string) {
    setStatsModal({
      lineId,
      lineName,
      stats: null,
      loading: true,
      failed: false,
    })

    try {
      const res = await fetch(`/api/lines/${lineId}/stats`)
      if (res.ok) {
        const data = await res.json()
        setStatsModal(prev => prev ? { ...prev, stats: data, loading: false } : null)
      } else {
        setStatsModal(prev => prev ? { ...prev, loading: false, failed: true } : null)
      }
    } catch {
      setStatsModal(prev => prev ? { ...prev, loading: false, failed: true } : null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
      <div className="border-b border-ink pb-6 mb-10">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-ink/60 mb-3">
          Your desk
        </p>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">Dashboard</h1>
      </div>

      {/* Onboarding Card */}
      {isNewUser && !onboardingDismissed && (
        <Card className="mb-6 border-ink">
          <CardContent className="py-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight mb-1">
                  Welcome to Waitlyst!
                </h2>
                <p className="text-ink/60 mb-4">
                  Lines you join and lines you run both show up here. To join one,
                  open the link or QR code you were given, or browse public lines.
                  To run one for your restaurant, shop, or drop, create a line.
                </p>
                <div className="flex gap-3">
                  <Link href="/lines/new" className={buttonClasses({ size: "sm" })}>Create a Line</Link>
                  <Link href="/browse" className={buttonClasses({ variant: "secondary", size: "sm" })}>Browse Lines</Link>
                </div>
              </div>
              <button
                onClick={dismissOnboarding}
                className="text-ink/60 hover:text-ink ml-4 -mr-2.5 -mt-2.5 p-2.5 flex-shrink-0 inline-flex items-center justify-center"
                aria-label="Dismiss"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search Bar: nothing to search until there's a line or a spot */}
      {(lines.length > 0 || positions.length > 0) && (
      <div className="relative mb-6">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg className="h-4 w-4 text-ink/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <Input
          ref={searchInputRef}
          type="text"
          placeholder="Search lines by name..."
          aria-label="Search your lines"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="pl-9 pr-9"
        />
        {searchText && (
          <button
            onClick={() => {
              setSearchText("")
              searchInputRef.current?.focus()
            }}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-ink/60 hover:text-ink"
            aria-label="Clear search"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      )}

      {/* Stats Modal */}
      {statsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div ref={statsDialogRef} className="bg-white border border-ink p-6 max-w-md w-full mx-4" role="dialog" aria-modal="true" aria-labelledby="stats-title">
            <h3 id="stats-title" ref={statsTitleRef} tabIndex={-1} className="text-lg font-semibold tracking-tight mb-4 focus:outline-none">
              {statsModal.lineName} - Line Stats
            </h3>

            {/* One always-mounted region, so loading, retrying and the result are announced */}
            <div aria-live="polite">
            {statsModal.loading ? (
              <div className="text-center py-4" role="status">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto" aria-hidden="true"></div>
                <p className="text-sm text-ink/60 mt-2">Loading stats...</p>
              </div>
            ) : statsModal.stats ? (
              <div className="space-y-4">
                {statsModal.stats.service && (() => {
                  const s = statsModal.stats.service
                  return (
                    <>
                      <p className="font-mono text-xs uppercase tracking-widest text-ink/60">Service</p>
                      <div className="grid grid-cols-3 divide-x divide-rule border border-rule">
                        <div className="p-3 text-center">
                          <p className="font-mono text-2xl tabular-nums">{s.served}</p>
                          <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mt-1">Served</p>
                        </div>
                        <div className="p-3 text-center">
                          <p className="font-mono text-2xl tabular-nums">{s.waiting}</p>
                          <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mt-1">Waiting</p>
                        </div>
                        <div className="p-3 text-center">
                          <p className="font-mono text-2xl tabular-nums">
                            {s.medianWaitMinutes === null ? "--" : formatWaitTime(s.medianWaitMinutes)}
                          </p>
                          <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mt-1">Typical wait</p>
                        </div>
                      </div>
                      <p className="text-xs text-ink/60 text-center">
                        {s.servedLastHour} served in the last hour · {s.left} left on their own · {s.removed} removed
                      </p>
                    </>
                  )
                })()}

                {/* A 0% fee line has nothing to earn: a big green $0.00 reads as "no sales" */}
                {((statsModal.stats.ownerFeePercent ?? 1) > 0 || (statsModal.stats.ownerFeeEarned ?? 0) > 0 || (statsModal.stats.ownerFeePending ?? 0) > 0) && (
                <div className="border border-ink p-4 text-center">
                  <p className="font-mono text-3xl tabular-nums text-green-700">
                    {formatCurrency(statsModal.stats.ownerFeeEarned ?? 0)}
                  </p>
                  <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mt-1">Your Fee Earnings</p>
                  {(statsModal.stats.ownerFeePending ?? 0) > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      + {formatCurrency(statsModal.stats.ownerFeePending ?? 0)} pending settlement
                    </p>
                  )}
                  {(statsModal.stats.ownerFeeAwaitingPayout ?? 0) > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      {formatCurrency(statsModal.stats.ownerFeeAwaitingPayout ?? 0)} collected but not yet sent to your payout account
                    </p>
                  )}
                </div>
                )}

                <p className="font-mono text-xs uppercase tracking-widest text-ink/60 pt-2">Swap volume</p>
                <div className="grid grid-cols-2 divide-x divide-rule border border-rule">
                  <div className="p-4 text-center">
                    <p className="font-mono text-2xl tabular-nums text-green-700">
                      {formatCurrency(statsModal.stats.totalCompleted)}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mt-1">
                      {statsModal.stats.kind === "RESTAURANT" ? "Settled" : "Collected"} ({statsModal.stats.completedCount})
                    </p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="font-mono text-2xl tabular-nums text-accent">
                      {formatCurrency(statsModal.stats.totalRefunded)}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mt-1">
                      {/* Includes holds cancelled before anyone was charged */}
                      Refunded or released ({statsModal.stats.refundedCount})
                    </p>
                  </div>
                </div>

                {statsModal.stats.pendingSettlement > 0 && (
                  <div className="border border-rule p-4 text-center">
                    <p className="font-mono text-2xl tabular-nums text-amber-700">
                      {formatCurrency(statsModal.stats.pendingSettlement)}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mt-1">
                      {statsModal.stats.kind === "RESTAURANT" ? "Pending Settlement" : "Not collected"} ({statsModal.stats.pendingSettlementCount})
                    </p>
                    <p className="text-xs text-ink/60 mt-1">
                      {statsModal.stats.kind === "RESTAURANT"
                        ? "Collected when each buyer is seated"
                        // Drop swaps are collected the moment they happen, so an open one means collecting failed
                        : "Couldn't be collected automatically -- check the settlement page"}
                    </p>
                  </div>
                )}

                <p className="text-sm text-ink/60 text-center">
                  {/* Same count as settlement: refunded and released swaps didn't go through */}
                  Swaps that went through: {statsModal.stats.completedCount + statsModal.stats.pendingSettlementCount}
                </p>
              </div>
            ) : statsModal.failed ? (
              <div className="text-sm text-ink/60" role="alert">
                <p>Couldn&apos;t load stats. Check your connection and try again.</p>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => {
                  // The button unmounts while it reloads; keep focus inside the dialog
                  statsTitleRef.current?.focus()
                  openStatsModal(statsModal.lineId, statsModal.lineName)
                }}>
                  Try again
                </Button>
              </div>
            ) : (
              <p className="text-sm text-ink/60">No transaction data available.</p>
            )}
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  const link = document.createElement("a")
                  link.href = `/api/lines/${statsModal.lineId}/export`
                  link.download = ""
                  document.body.appendChild(link)
                  link.click()
                  document.body.removeChild(link)
                }}
                className="flex-1"
              >
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export CSV
              </Button>
              {(statsModal.stats?.totalTransactions ?? 0) > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const link = document.createElement("a")
                    link.href = `/api/lines/${statsModal.lineId}/export?type=swaps`
                    link.download = ""
                    document.body.appendChild(link)
                    link.click()
                    document.body.removeChild(link)
                  }}
                  className="flex-1"
                >
                  Swaps CSV
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => setStatsModal(null)}
                className="flex-1"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={!!deleteConfirm}
        title="Delete Line"
        message={`Delete "${deleteConfirm?.lineName || ""}"? Everyone in it is removed, any swap payment still on hold is refunded, and you lose access to its settlement page. Export the people list and the swaps CSV first if you need a record. This can't be undone.`}
        confirmLabel="Delete"
        variant="danger"
        isLoading={!!deleteConfirm && loadingAction === `delete-${deleteConfirm.lineId}`}
        onConfirm={() => deleteConfirm && handleDeleteLine(deleteConfirm.lineId)}
        onCancel={() => setDeleteConfirm(null)}
      />

      {/* Remove Front Confirmation Modal */}
      <ConfirmModal
        open={!!removeConfirm}
        title="Remove Person"
        message={removeConfirm ? `Remove ${removeConfirm.name} from the front of the line? If they haven't been served, any payment of theirs still on hold is refunded.` : ""}
        confirmLabel="Remove"
        variant="danger"
        isLoading={!!removeConfirm && loadingAction === `remove-${removeConfirm.lineId}`}
        onConfirm={() => removeConfirm && handleRemoveFront(removeConfirm.lineId, removeConfirm.positionId, removeConfirm.name)}
        onCancel={() => setRemoveConfirm(null)}
      />

      {/* Lines I'm In */}
      <Card className="mb-8">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60">My Positions</h2>
          {positions.length > 0 && (
            <select
              value={positionsSort}
              onChange={(e) => setPositionsSort(e.target.value as SortOption)}
              aria-label="Sort my positions"
              className="text-sm border border-rule px-2 py-1 min-h-11 pointer-fine:min-h-0 bg-white text-ink/70 focus:outline-none focus:border-ink"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="most-members">Most members</option>
            </select>
          )}
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-ink/60 mb-4">You haven&apos;t joined any lines yet.</p>
              <Link href="/browse" className={buttonClasses({ variant: "secondary" })}>Browse Lines</Link>
            </div>
          ) : filteredPositions.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-ink/60">No positions match your search.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPositions.map((pos) => (
                <Link
                  key={pos.id}
                  href={`/lines/${pos.lineId}`}
                  className="block"
                >
                  <div className={`flex items-center justify-between p-4 bg-paper hover:bg-ink/5 transition-colors ${
                    pos.phase === "called" ? "border-l-2 border-l-accent" : ""
                  }`}>
                    <div className="min-w-0">
                      <h3 className="font-semibold tracking-tight">{pos.line.name}</h3>
                      <p className="text-sm">
                        <span className={phaseLabel[pos.phase].className}>
                          {phaseLabel[pos.phase].text(pos.ahead, pos.line.kind === "RESTAURANT")}
                        </span>
                        <span className="text-ink/60">
                          {" · "}{pos.line._count.positions} in line
                          {!pos.line.isActive && " · Paused"}
                        </span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-lg tabular-nums">
                        {pos.phase === "served"
                          ? <span role="img" aria-label={pos.line.kind === "RESTAURANT" ? "Seated" : "Served"}>✓</span>
                          : `#${pos.ahead + 1}`}
                      </p>
                      {pos.askingPrice !== null && (
                        <p className="text-sm text-green-700">
                          Open to swap: {formatCurrency(Number(pos.askingPrice))}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lines I've Created */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60">Lines I Created</h2>
          <div className="flex flex-wrap items-center gap-2">
            {lines.length > 0 && (
              <select
                value={createdSort}
                onChange={(e) => setCreatedSort(e.target.value as SortOption)}
                aria-label="Sort lines I created"
                className="text-sm border border-rule px-2 py-1 min-h-11 pointer-fine:min-h-0 bg-white text-ink/70 focus:outline-none focus:border-ink"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="most-members">Most members</option>
              </select>
            )}
            <Link href="/lines/new" className={buttonClasses({ size: "sm" })}>Create Line</Link>
          </div>
        </CardHeader>
        <CardContent>
          {lines.length > 0 && (
            <div className="flex items-center gap-5 mb-4">
              {(["all", "active", "paused", "closed"] as const).filter((f) => f !== "closed" || statusCounts.closed > 0).map((filter) => {
                const count = statusCounts[filter]
                const isSelected = statusFilter === filter
                const label = filter.charAt(0).toUpperCase() + filter.slice(1)
                return (
                  <button
                    key={filter}
                    onClick={() => setStatusFilter(filter)}
                    aria-pressed={isSelected}
                    className={`font-mono text-xs uppercase tracking-widest pt-3 pb-2 sm:pt-0 sm:pb-1 border-b-2 transition-colors ${
                      isSelected
                        ? "border-accent text-ink"
                        : "border-transparent text-ink/60 hover:text-ink"
                    }`}
                  >
                    {label}
                    <span className={`ml-1.5 tabular-nums ${
                      isSelected
                        ? "text-ink/70"
                        : "text-ink/60"
                    }`}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {lines.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-ink/60 mb-4">You haven&apos;t created any lines yet.</p>
              <Link href="/lines/new" className={buttonClasses({ variant: "secondary" })}>Create Your First Line</Link>
            </div>
          ) : filteredLines.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-ink/60">No lines match your search or filters.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLines.map((line) => (
                <div
                  key={line.id}
                  className="p-4 bg-paper"
                >
                  <div className="flex items-center justify-between">
                    <Link href={`/lines/${line.id}`} className="flex-1 min-w-0">
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-semibold tracking-tight truncate">{line.name}</h3>
                          <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest flex-shrink-0 ${
                            line.isPublic
                              ? "text-green-700"
                              : "text-ink/60"
                          }`}>
                            <span className={`w-1.5 h-1.5 ${line.isPublic ? "bg-green-600" : "bg-ink/30"}`} aria-hidden />
                            {line.isPublic ? "Public" : "Private"}
                          </span>
                          {/* Past its closing time it's Closed, paused or not (as on the embed) */}
                          {!line.isActive && !(line.closesAt && new Date(line.closesAt) <= new Date()) && (
                            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-amber-700 flex-shrink-0">
                              <span className="w-1.5 h-1.5 bg-amber-500" aria-hidden />
                              Paused
                            </span>
                          )}
                          {line.maxCapacity != null && line.capacityUsed != null && line.capacityUsed >= line.maxCapacity && (
                            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-accent flex-shrink-0">
                              <span className="w-1.5 h-1.5 bg-accent" aria-hidden />
                              Full
                            </span>
                          )}
                          {/* A drop past its close time, or not open yet, isn't "live" */}
                          {line.closesAt && new Date(line.closesAt) <= new Date() ? (
                            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-ink/60 flex-shrink-0">
                              <span className="w-1.5 h-1.5 bg-ink/40" aria-hidden />
                              Closed
                            </span>
                          ) : line.opensAt && new Date(line.opensAt) > new Date() ? (
                            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-ink/60 flex-shrink-0">
                              <span className="w-1.5 h-1.5 bg-ink/40" aria-hidden />
                              Opens {formatDateTime(line.opensAt, { withZone: true })}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm text-ink/60 mt-1">
                          {line._count.positions} waiting
                          {line.maxCapacity != null && line.capacityUsed != null && (
                            <span className="tabular-nums">
                              {" · "}{line.capacityUsed}/{line.maxCapacity} {line.kind === "RESTAURANT" ? "seats" : "spots"}
                            </span>
                          )}
                          {line.frontPerson && (
                            <span>
                              {" · "} Next: {line.frontPerson.user.name || "Anonymous"}
                            </span>
                          )}
                        </p>
                      </div>
                    </Link>
                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                      {line.frontPerson && (
                        <div className="flex items-center gap-1">
                          {/* Call next always calls the first person not yet served,
                              so once they're called the next step is serving them. */}
                          {line.frontPerson.calledAt && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={(e) => {
                                e.preventDefault()
                                handleServeFront(line.id, line.frontPerson!.id, line.frontPerson!.user.name || "Guest", line.kind === "RESTAURANT" ? "seated" : "served")
                              }}
                              isLoading={loadingAction === `serve-${line.id}`}
                            >
                              {line.kind === "RESTAURANT" ? "Mark Seated" : "Mark Served"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={line.frontPerson.calledAt ? "ghost" : "secondary"}
                            onClick={(e) => {
                              e.preventDefault()
                              handleCallNext(line.id, line.frontPerson!.id)
                            }}
                            isLoading={loadingAction === `call-${line.id}`}
                          >
                            {line.frontPerson.calledAt ? "Call Again" : "Call Next"}
                          </Button>
                          {/* remove-front removes position #1; when served people are still
                              ahead of the next person, that would remove the wrong one. */}
                          {line.frontPerson.position === 1 && (
                            <button
                              onClick={(e) => {
                                e.preventDefault()
                                setRemoveConfirm({
                                  lineId: line.id,
                                  positionId: line.frontPerson!.id,
                                  name: line.frontPerson!.user.name || "this person",
                                })
                              }}
                              disabled={loadingAction === `remove-${line.id}`}
                              className="text-xs text-accent hover:underline underline-offset-4 px-1 py-0.5 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      )}
                      {!line.isActive && isClosedBySchedule(line) ? (
                        // Resuming wouldn't let anyone join past the closing time
                        <Link
                          href={`/lines/${line.id}/edit`}
                          className={buttonClasses({ variant: "secondary", size: "sm" })}
                          title="This line is past its closing time"
                        >
                          Change hours
                        </Link>
                      ) : !line.isActive && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.preventDefault()
                            handleTogglePause(line.id)
                          }}
                          isLoading={loadingAction === `pause-${line.id}`}
                        >
                          Resume
                        </Button>
                      )}
                      <DropdownMenu
                        items={(() => {
                          const menuItems: DropdownMenuItem[] = [
                            { label: "View Stats", onClick: () => openStatsModal(line.id, line.name) },
                            { label: "Analytics", onClick: () => router.push(`/lines/${line.id}/analytics`) },
                            { label: "Settlement", onClick: () => router.push(`/lines/${line.id}/settlement`) },
                            { label: copiedId === line.id ? "Copied!" : "Copy Link", onClick: () => handleCopyLink(line.id) },
                            { label: "Edit", onClick: () => router.push(`/lines/${line.id}/edit`) },
                            { label: loadingAction === `duplicate-${line.id}` ? "Duplicating..." : "Duplicate", onClick: () => handleDuplicateLine(line.id), disabled: loadingAction === `duplicate-${line.id}` },
                            { label: `Make ${line.isPublic ? "Private" : "Public"}`, onClick: () => handleTogglePublic(line.id, line.isPublic), disabled: loadingAction === `toggle-${line.id}` },
                          ]
                          if (line.isActive) {
                            menuItems.push({ label: "Pause", onClick: () => handleTogglePause(line.id) })
                          }
                          menuItems.push({ label: "Delete", onClick: () => setDeleteConfirm({ lineId: line.id, lineName: line.name }), variant: "danger" })
                          return menuItems
                        })()}
                        separatorBefore={[line.isActive ? 7 : 6]}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity Feed */}
      <Card className="mt-8">
        <CardHeader>
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60">Recent Activity</h2>
        </CardHeader>
        <CardContent>
          {activitiesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-ink/5 animate-pulse" />
              ))}
            </div>
          ) : activities.length === 0 && activitiesFailed ? (
            <div className="text-center py-6" role="alert">
              <p className="text-ink/60 mb-3">Couldn&apos;t load your activity.</p>
              <Button size="sm" variant="secondary" onClick={() => { setActivitiesLoading(true); fetchActivities() }}>
                Try again
              </Button>
            </div>
          ) : activities.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-ink/60">No recent activity.</p>
              <p className="text-sm text-ink/60 mt-1">
                Join a line or swap a position to see activity here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {activities.map((activity) => {
                const dotColors: Record<string, string> = {
                  joined: "bg-ink/30",
                  purchase: "bg-accent",
                  sale: "bg-green-600",
                  refund: "bg-amber-500",
                  served: "bg-green-600",
                  left: "bg-ink/30",
                  removed: "bg-red-600",
                  offer: "bg-accent",
                }
                const dotColor = dotColors[activity.type] || dotColors.joined

                return (
                  <div
                    key={activity.id}
                    className="flex items-center gap-3 p-3 bg-paper hover:bg-ink/5 transition-colors"
                  >
                    <span className={`w-1.5 h-1.5 flex-shrink-0 ${dotColor}`} aria-hidden />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{activity.description}</p>
                      {activity.lineName && activity.lineId && (
                        <Link
                          href={`/lines/${activity.lineId}`}
                          className="text-xs text-accent hover:underline underline-offset-4"
                        >
                          {activity.lineName}
                        </Link>
                      )}
                    </div>
                    <span className="font-mono text-xs text-ink/60 flex-shrink-0">{timeAgo(activity.createdAt)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

