"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useEffect, useMemo, useRef } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { ConfirmModal } from "@/components/ui/ConfirmModal"
import { useToast } from "@/components/ui/Toast"

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
    user: { id: string; name: string | null }
  } | null
}

interface Position {
  id: string
  lineId: string
  position: number
  askingPrice: string | null
  joinedAt: string
  line: {
    name: string
    createdAt: string
    _count: { positions: number }
  }
}

type StatusFilter = "all" | "active" | "paused"
type SortOption = "newest" | "oldest" | "most-members"

interface LineStats {
  totalTransactions: number
  completedCount: number
  refundedCount: number
  pendingSettlementCount: number
  totalCompleted: number
  totalRefunded: number
  pendingSettlement: number
  netRevenue: number
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

export function DashboardClient({ createdLines: initialLines, positions }: DashboardClientProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const [lines, setLines] = useState(initialLines)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [statsModal, setStatsModal] = useState<StatsModal | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ lineId: string; lineName: string } | null>(null)
  const [removeConfirm, setRemoveConfirm] = useState<{ lineId: string } | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

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

    // Sort
    result = [...result].sort((a, b) => {
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

  // Poll for dashboard updates (position changes, new joins, etc.)
  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh()
    }, 10000) // Refresh every 10 seconds
    return () => clearInterval(interval)
  }, [router])

  // Sync lines state when server data changes
  useEffect(() => {
    setLines(initialLines)
  }, [initialLines])

  async function handleRemoveFront(lineId: string) {
    setRemoveConfirm(null)
    setLoadingAction(`remove-${lineId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/remove-front`, {
        method: "POST",
      })
      if (res.ok) {
        addToast("Person removed from front of line", "success")
        router.refresh()
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to remove person", "error")
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
    try {
      const res = await fetch(`/api/lines/${lineId}/pause`, {
        method: "POST",
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
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Dashboard</h1>

      {/* Search Bar */}
      <div className="relative mb-6">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Stats Modal */}
      {statsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {statsModal.lineName} - Transaction Stats
            </h3>

            {statsModal.loading ? (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-sm text-gray-500 mt-2">Loading stats...</p>
              </div>
            ) : statsModal.stats ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-green-700">
                      ${statsModal.stats.totalCompleted.toFixed(2)}
                    </p>
                    <p className="text-sm text-green-600">
                      Settled ({statsModal.stats.completedCount})
                    </p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-red-700">
                      ${statsModal.stats.totalRefunded.toFixed(2)}
                    </p>
                    <p className="text-sm text-red-600">
                      Refunded ({statsModal.stats.refundedCount})
                    </p>
                  </div>
                </div>

                {statsModal.stats.pendingSettlement > 0 && (
                  <div className="bg-yellow-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-yellow-700">
                      ${statsModal.stats.pendingSettlement.toFixed(2)}
                    </p>
                    <p className="text-sm text-yellow-600">
                      Pending Settlement ({statsModal.stats.pendingSettlementCount})
                    </p>
                    <p className="text-xs text-yellow-500 mt-1">
                      Settles when both parties leave
                    </p>
                  </div>
                )}

                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <p className="text-3xl font-bold text-blue-700">
                    ${statsModal.stats.netRevenue.toFixed(2)}
                  </p>
                  <p className="text-sm text-blue-600">Net Revenue (Settled)</p>
                </div>

                <p className="text-sm text-gray-500 text-center">
                  Total transactions: {statsModal.stats.totalTransactions}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-600">No transaction data available.</p>
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
        message={`Are you sure you want to delete "${deleteConfirm?.lineName || ""}"? This cannot be undone.`}
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
        message="Remove the person at the front of the line?"
        confirmLabel="Remove"
        variant="danger"
        isLoading={!!removeConfirm && loadingAction === `remove-${removeConfirm.lineId}`}
        onConfirm={() => removeConfirm && handleRemoveFront(removeConfirm.lineId)}
        onCancel={() => setRemoveConfirm(null)}
      />

      {/* Lines I'm In */}
      <Card className="mb-8">
        <CardHeader className="flex flex-row items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">My Positions</h2>
          {positions.length > 0 && (
            <select
              value={positionsSort}
              onChange={(e) => setPositionsSort(e.target.value as SortOption)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <p className="text-gray-500 mb-4">You haven&apos;t joined any lines yet.</p>
              <Link href="/">
                <Button variant="secondary">Browse Lines</Button>
              </Link>
            </div>
          ) : filteredPositions.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-gray-500">No positions match your search.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPositions.map((pos) => (
                <Link
                  key={pos.id}
                  href={`/lines/${pos.lineId}`}
                  className="block"
                >
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div>
                      <h3 className="font-medium text-gray-900">{pos.line.name}</h3>
                      <p className="text-sm text-gray-500">
                        {pos.line._count.positions} people in line
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-blue-600">#{pos.position}</p>
                      {pos.askingPrice !== null && (
                        <p className="text-sm text-green-600">
                          For sale: ${Number(pos.askingPrice).toFixed(2)}
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
          <h2 className="text-xl font-semibold text-gray-900">Lines I Created</h2>
          <div className="flex items-center gap-2">
            {lines.length > 0 && (
              <select
                value={createdSort}
                onChange={(e) => setCreatedSort(e.target.value as SortOption)}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <div className="flex items-center gap-1 mb-4">
              {(["all", "active", "paused"] as const).map((filter) => {
                const count = statusCounts[filter]
                const isSelected = statusFilter === filter
                const label = filter.charAt(0).toUpperCase() + filter.slice(1)
                return (
                  <button
                    key={filter}
                    onClick={() => setStatusFilter(filter)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                      isSelected
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {label}
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                      isSelected
                        ? "bg-blue-200 text-blue-800"
                        : "bg-gray-200 text-gray-500"
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
              <p className="text-gray-500 mb-4">You haven&apos;t created any lines yet.</p>
              <Link href="/lines/new">
                <Button variant="secondary">Create Your First Line</Button>
              </Link>
            </div>
          ) : filteredLines.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-gray-500">No lines match your search or filters.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLines.map((line) => (
                <div
                  key={line.id}
                  className="p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center justify-between">
                    <Link href={`/lines/${line.id}`} className="flex-1 min-w-0">
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-medium text-gray-900 truncate">{line.name}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${
                            line.isPublic
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-200 text-gray-600"
                          }`}>
                            {line.isPublic ? "Public" : "Private"}
                          </span>
                          {!line.isActive && (
                            <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0">
                              Paused
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
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
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.preventDefault()
                            setRemoveConfirm({ lineId: line.id })
                          }}
                          isLoading={loadingAction === `remove-${line.id}`}
                        >
                          Serve Next
                        </Button>
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
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            setOpenMenuId(openMenuId === line.id ? null : line.id)
                          }}
                          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>
                        {openMenuId === line.id && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setOpenMenuId(null)}
                            />
                            <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                              <button
                                onClick={() => { openStatsModal(line.id, line.name); setOpenMenuId(null) }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                View Stats
                              </button>
                              <button
                                onClick={() => { handleCopyLink(line.id); setOpenMenuId(null) }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                {copiedId === line.id ? "Copied!" : "Copy Link"}
                              </button>
                              <Link
                                href={`/lines/${line.id}/edit`}
                                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                onClick={() => setOpenMenuId(null)}
                              >
                                Edit
                              </Link>
                              <button
                                onClick={() => { handleTogglePublic(line.id, line.isPublic); setOpenMenuId(null) }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                Make {line.isPublic ? "Private" : "Public"}
                              </button>
                              {line.isActive && (
                                <button
                                  onClick={() => { handleTogglePause(line.id); setOpenMenuId(null) }}
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  Pause
                                </button>
                              )}
                              <div className="border-t border-gray-100 my-1" />
                              <button
                                onClick={() => { setDeleteConfirm({ lineId: line.id, lineName: line.name }); setOpenMenuId(null) }}
                                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                              >
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
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
          <h2 className="text-xl font-semibold text-gray-900">Recent Activity</h2>
        </CardHeader>
        <CardContent>
          {activitiesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : activities.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-gray-500">No recent activity.</p>
              <p className="text-sm text-gray-400 mt-1">
                Join a line or trade a position to see activity here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {activities.map((activity) => {
                const iconStyles: Record<string, { bg: string; icon: string; path: string }> = {
                  joined: {
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
                const style = iconStyles[activity.type] || iconStyles.joined
                const timeAgo = getTimeAgo(activity.createdAt)

                return (
                  <div
                    key={activity.id}
                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${style.bg}`}>
                      <svg className={`w-4 h-4 ${style.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={style.path} />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{activity.description}</p>
                      {activity.lineName && activity.lineId && (
                        <Link
                          href={`/lines/${activity.lineId}`}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {activity.lineName}
                        </Link>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{timeAgo}</span>
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

function getTimeAgo(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
