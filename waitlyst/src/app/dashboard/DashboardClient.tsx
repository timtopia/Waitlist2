"use client"

import Link from "next/link"
import { useDialog } from "@/lib/use-dialog"
import { useRouter } from "next/navigation"
import { useState, useEffect, useMemo, useRef } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { ConfirmModal } from "@/components/ui/ConfirmModal"
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/DropdownMenu"
import { useToast } from "@/components/ui/Toast"
import { timeAgo, formatCurrency } from "@/lib/format"
import { formatWaitTime } from "@/lib/wait-time"
import type { MemberPhase } from "@/lib/member-status"

interface CreatedLine {
  id: string
  name: string
  description: string | null
  isActive: boolean
  isPublic: boolean
  createdAt: string
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
    _count: { positions: number }
  }
}

const phaseLabel: Record<MemberPhase, { text: (ahead: number) => string; className: string }> = {
  called: { text: () => "Your turn. Head to the front", className: "text-accent font-semibold" },
  next: { text: () => "You're next", className: "text-green-700" },
  served: { text: () => "Served", className: "text-green-700" },
  waiting: { text: (ahead) => `${ahead} ahead of you`, className: "text-ink/60" },
}

type StatusFilter = "all" | "active" | "paused"
type SortOption = "newest" | "oldest" | "most-members"

interface LineStats {
  ownerFeeEarned?: number
  ownerFeePending?: number
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
}

interface DashboardClientProps {
  createdLines: CreatedLine[]
  positions: Position[]
  isNewUser?: boolean
}

interface Activity {
  id: string
  type: "joined" | "purchase" | "sale" | "refund"
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
      active: searchFiltered.filter(l => l.isActive).length,
      paused: searchFiltered.filter(l => !l.isActive).length,
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
      result = result.filter(l => l.isActive)
    } else if (statusFilter === "paused") {
      result = result.filter(l => !l.isActive)
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
      if (positionsSort === "newest") return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime()
      if (positionsSort === "oldest") return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
      return b.line._count.positions - a.line._count.positions // most-members
    })

    return result
  }, [positions, searchText, positionsSort])

  // Activity Feed
  const [activities, setActivities] = useState<Activity[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(true)

  useEffect(() => {
    async function fetchActivities() {
      try {
        const res = await fetch("/api/activity")
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data)) {
            setActivities(data)
          }
        }
      } finally {
        setActivitiesLoading(false)
      }
    }
    fetchActivities()
  }, [])

  // Poll for dashboard updates — only when tab is visible, every 60 seconds
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null

    function start() {
      if (!interval) {
        interval = setInterval(() => {
          if (document.visibilityState === "visible") router.refresh()
        }, 60000)
      }
    }

    function stop() {
      if (interval) { clearInterval(interval); interval = null }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        router.refresh() // Immediate refresh when tab comes back
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
  }, [router])

  // Sync lines state when server data changes
  useEffect(() => {
    setLines(initialLines)
  }, [initialLines])

  async function handleCallNext(lineId: string) {
    setLoadingAction(`call-${lineId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/call-next`, {
        method: "POST",
      })
      if (res.ok) {
        const data = await res.json()
        addToast(`Called ${data.calledUser} to the front!`, "success")
        router.refresh()
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to call next person", "error")
      }
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleServeFront(lineId: string, positionId: string, name: string) {
    setLoadingAction(`serve-${lineId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/fulfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId }),
      })
      if (res.ok) {
        addToast(`${name} marked as served`, "success")
        router.refresh()
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to mark as served", "error")
      }
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
        const data = await res.json()
        addToast(data.error || "Failed to remove person", "error")
      }
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
        const data = await res.json()
        addToast(data.error || "Failed to duplicate line", "error")
      }
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
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to delete line", "error")
      }
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
        const data = await res.json()
        addToast(data.error || "Failed to update", "error")
      }
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
        const data = await res.json()
        addToast(data.error || "Failed to update", "error")
      }
    } finally {
      setLoadingAction(null)
    }
  }

  function handleCopyLink(lineId: string) {
    const url = `${window.location.origin}/lines/${lineId}`
    navigator.clipboard.writeText(url)
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
    })

    try {
      const res = await fetch(`/api/lines/${lineId}/stats`)
      if (res.ok) {
        const data = await res.json()
        setStatsModal(prev => prev ? { ...prev, stats: data, loading: false } : null)
      } else {
        setStatsModal(prev => prev ? { ...prev, loading: false } : null)
      }
    } catch {
      setStatsModal(prev => prev ? { ...prev, loading: false } : null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
      <div className="border-b border-ink pb-6 mb-10">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-ink/50 mb-3">
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
                  Get started by creating your first line or browsing existing ones.
                </p>
                <div className="flex gap-3">
                  <Link href="/lines/new">
                    <Button size="sm">Create a Line</Button>
                  </Link>
                  <Link href="/browse">
                    <Button size="sm" variant="secondary">Browse Lines</Button>
                  </Link>
                </div>
              </div>
              <button
                onClick={dismissOnboarding}
                className="text-ink/40 hover:text-ink ml-4 flex-shrink-0"
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

      {/* Search Bar */}
      <div className="relative mb-6">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg className="h-4 w-4 text-ink/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <Input
          ref={searchInputRef}
          type="text"
          placeholder="Search lines by name..."
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
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-ink/40 hover:text-ink"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Stats Modal */}
      {statsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div ref={statsDialogRef} className="bg-white border border-ink p-6 max-w-md w-full mx-4" role="dialog" aria-modal="true" aria-label={`${statsModal.lineName} stats`}>
            <h3 className="text-lg font-semibold tracking-tight mb-4">
              {statsModal.lineName} - Line Stats
            </h3>

            {statsModal.loading ? (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
                <p className="text-sm text-ink/50 mt-2">Loading stats...</p>
              </div>
            ) : statsModal.stats ? (
              <div className="space-y-4">
                {statsModal.stats.service && (() => {
                  const s = statsModal.stats.service
                  return (
                    <>
                      <p className="font-mono text-xs uppercase tracking-widest text-ink/40">Service</p>
                      <div className="grid grid-cols-3 divide-x divide-rule border border-rule">
                        <div className="p-3 text-center">
                          <p className="font-mono text-2xl tabular-nums">{s.served}</p>
                          <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mt-1">Served</p>
                        </div>
                        <div className="p-3 text-center">
                          <p className="font-mono text-2xl tabular-nums">{s.waiting}</p>
                          <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mt-1">Waiting</p>
                        </div>
                        <div className="p-3 text-center">
                          <p className="font-mono text-2xl tabular-nums">
                            {s.medianWaitMinutes === null ? "--" : formatWaitTime(s.medianWaitMinutes)}
                          </p>
                          <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mt-1">Typical wait</p>
                        </div>
                      </div>
                      <p className="text-xs text-ink/50 text-center">
                        {s.servedLastHour} served in the last hour · {s.left} left on their own · {s.removed} removed
                      </p>
                    </>
                  )
                })()}

                <div className="border border-ink p-4 text-center">
                  <p className="font-mono text-3xl tabular-nums text-green-700">
                    {formatCurrency(statsModal.stats.ownerFeeEarned ?? 0)}
                  </p>
                  <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mt-1">Your Fee Earnings</p>
                  {(statsModal.stats.ownerFeePending ?? 0) > 0 && (
                    <p className="text-xs text-amber-600 mt-1">
                      + {formatCurrency(statsModal.stats.ownerFeePending ?? 0)} pending settlement
                    </p>
                  )}
                </div>

                <p className="font-mono text-xs uppercase tracking-widest text-ink/40 pt-2">Swap volume (paid to sellers)</p>
                <div className="grid grid-cols-2 divide-x divide-rule border border-rule">
                  <div className="p-4 text-center">
                    <p className="font-mono text-2xl tabular-nums text-green-700">
                      {formatCurrency(statsModal.stats.totalCompleted)}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mt-1">
                      Settled ({statsModal.stats.completedCount})
                    </p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="font-mono text-2xl tabular-nums text-accent">
                      {formatCurrency(statsModal.stats.totalRefunded)}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mt-1">
                      Refunded ({statsModal.stats.refundedCount})
                    </p>
                  </div>
                </div>

                {statsModal.stats.pendingSettlement > 0 && (
                  <div className="border border-rule p-4 text-center">
                    <p className="font-mono text-2xl tabular-nums text-amber-600">
                      {formatCurrency(statsModal.stats.pendingSettlement)}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mt-1">
                      Pending Settlement ({statsModal.stats.pendingSettlementCount})
                    </p>
                    <p className="text-xs text-ink/40 mt-1">
                      Collected when each buyer is served
                    </p>
                  </div>
                )}

                <div className="border border-rule p-4 text-center">
                  <p className="font-mono text-2xl tabular-nums">
                    {formatCurrency(statsModal.stats.netRevenue)}
                  </p>
                  <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mt-1">Net Swap Volume (Settled)</p>
                </div>

                <p className="text-sm text-ink/50 text-center">
                  Total transactions: {statsModal.stats.totalTransactions}
                </p>
              </div>
            ) : (
              <p className="text-sm text-ink/60">No transaction data available.</p>
            )}

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
        message={`Delete "${deleteConfirm?.lineName || ""}"? Everyone in it is removed and emailed, any swap payment still on hold is refunded, and you lose access to its settlement page. Export it first if you need a record. This can't be undone.`}
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
        <CardHeader className="flex flex-row items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60">My Positions</h2>
          {positions.length > 0 && (
            <select
              value={positionsSort}
              onChange={(e) => setPositionsSort(e.target.value as SortOption)}
              className="text-sm border border-rule px-2 py-1 bg-white text-ink/70 focus:outline-none focus:border-ink"
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
              <Link href="/browse">
                <Button variant="secondary">Browse Lines</Button>
              </Link>
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
                          {phaseLabel[pos.phase].text(pos.ahead)}
                        </span>
                        <span className="text-ink/40">
                          {" · "}{pos.line._count.positions} in line
                          {!pos.line.isActive && " · Paused"}
                        </span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-lg tabular-nums">#{pos.position}</p>
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
        <CardHeader className="flex flex-row items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60">Lines I Created</h2>
          <div className="flex items-center gap-2">
            {lines.length > 0 && (
              <select
                value={createdSort}
                onChange={(e) => setCreatedSort(e.target.value as SortOption)}
                className="text-sm border border-rule px-2 py-1 bg-white text-ink/70 focus:outline-none focus:border-ink"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="most-members">Most members</option>
              </select>
            )}
            <Link href="/lines/new">
              <Button size="sm">Create Line</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {lines.length > 0 && (
            <div className="flex items-center gap-5 mb-4">
              {(["all", "active", "paused"] as const).map((filter) => {
                const count = statusCounts[filter]
                const isSelected = statusFilter === filter
                const label = filter.charAt(0).toUpperCase() + filter.slice(1)
                return (
                  <button
                    key={filter}
                    onClick={() => setStatusFilter(filter)}
                    className={`font-mono text-xs uppercase tracking-widest pb-1 border-b-2 transition-colors ${
                      isSelected
                        ? "border-accent text-ink"
                        : "border-transparent text-ink/40 hover:text-ink"
                    }`}
                  >
                    {label}
                    <span className={`ml-1.5 tabular-nums ${
                      isSelected
                        ? "text-ink/60"
                        : "text-ink/30"
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
              <Link href="/lines/new">
                <Button variant="secondary">Create Your First Line</Button>
              </Link>
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
                              : "text-ink/50"
                          }`}>
                            <span className={`w-1.5 h-1.5 ${line.isPublic ? "bg-green-600" : "bg-ink/30"}`} aria-hidden />
                            {line.isPublic ? "Public" : "Private"}
                          </span>
                          {!line.isActive && (
                            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-amber-600 flex-shrink-0">
                              <span className="w-1.5 h-1.5 bg-amber-500" aria-hidden />
                              Paused
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-ink/60 mt-1">
                          {line._count.positions} in line
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
                                handleServeFront(line.id, line.frontPerson!.id, line.frontPerson!.user.name || "Guest")
                              }}
                              isLoading={loadingAction === `serve-${line.id}`}
                            >
                              Mark Served
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={line.frontPerson.calledAt ? "ghost" : "secondary"}
                            onClick={(e) => {
                              e.preventDefault()
                              handleCallNext(line.id)
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
                      {!line.isActive && (
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
                            { label: "Settlement", onClick: () => router.push(`/lines/${line.id}/settlement`) },
                            { label: copiedId === line.id ? "Copied!" : "Copy Link", onClick: () => handleCopyLink(line.id) },
                            { label: "Edit", onClick: () => router.push(`/lines/${line.id}/edit`) },
                            { label: loadingAction === `duplicate-${line.id}` ? "Duplicating..." : "Duplicate", onClick: () => handleDuplicateLine(line.id), disabled: loadingAction === `duplicate-${line.id}` },
                            { label: `Make ${line.isPublic ? "Private" : "Public"}`, onClick: () => handleTogglePublic(line.id, line.isPublic) },
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
          ) : activities.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-ink/60">No recent activity.</p>
              <p className="text-sm text-ink/40 mt-1">
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
                    <span className="font-mono text-xs text-ink/40 flex-shrink-0">{timeAgo(activity.createdAt)}</span>
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

