"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { ConfirmModal } from "@/components/ui/ConfirmModal"
import { useToast } from "@/components/ui/Toast"

interface CreatedLine {
  id: string
  name: string
  description: string | null
  isActive: boolean
  isPublic: boolean
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
  line: {
    name: string
    _count: { positions: number }
  }
}

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
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>

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

            <div className="mt-4">
              <Button
                variant="ghost"
                onClick={() => setStatsModal(null)}
                className="w-full"
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
        <CardHeader>
          <h2 className="text-xl font-semibold text-gray-900">My Positions</h2>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-gray-500 mb-4">You haven&apos;t joined any lines yet.</p>
              <Link href="/">
                <Button variant="secondary">Browse Lines</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {positions.map((pos) => (
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
          <Link href="/lines/new">
            <Button size="sm">Create Line</Button>
          </Link>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-gray-500 mb-4">You haven&apos;t created any lines yet.</p>
              <Link href="/lines/new">
                <Button variant="secondary">Create Your First Line</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {lines.map((line) => (
                <div
                  key={line.id}
                  className="p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                    <Link href={`/lines/${line.id}`} className="flex-1">
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-medium text-gray-900">{line.name}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            line.isPublic
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-200 text-gray-600"
                          }`}>
                            {line.isPublic ? "Public" : "Private"}
                          </span>
                        </div>
                        {line.description && (
                          <p className="text-sm text-gray-500 line-clamp-1">
                            {line.description}
                          </p>
                        )}
                        <p className="text-sm text-gray-500 mt-1">
                          {line._count.positions} in line
                          {line.frontPerson && (
                            <span>
                              {" "}- Next: {line.frontPerson.user.name || "Anonymous"}
                            </span>
                          )}
                        </p>
                      </div>
                    </Link>
                    <div className="flex flex-wrap items-center gap-2 ml-0 mt-3 sm:mt-0 sm:ml-4">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.preventDefault()
                          openStatsModal(line.id, line.name)
                        }}
                      >
                        Stats
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(e) => {
                          e.preventDefault()
                          handleCopyLink(line.id)
                        }}
                      >
                        {copiedId === line.id ? "Copied!" : "Copy Link"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.preventDefault()
                          handleTogglePublic(line.id, line.isPublic)
                        }}
                        isLoading={loadingAction === `toggle-${line.id}`}
                      >
                        Make {line.isPublic ? "Private" : "Public"}
                      </Button>
                      <Link
                        href={`/lines/${line.id}/edit`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button size="sm" variant="ghost">
                          Edit
                        </Button>
                      </Link>
                      {line.frontPerson && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={(e) => {
                            e.preventDefault()
                            setRemoveConfirm({ lineId: line.id })
                          }}
                          isLoading={loadingAction === `remove-${line.id}`}
                        >
                          Remove Front
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={(e) => {
                          e.preventDefault()
                          setDeleteConfirm({ lineId: line.id, lineName: line.name })
                        }}
                        isLoading={loadingAction === `delete-${line.id}`}
                      >
                        Delete
                      </Button>
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
