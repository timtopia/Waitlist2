"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"

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

export function DashboardClient({ createdLines: initialLines, positions }: DashboardClientProps) {
  const router = useRouter()
  const [lines, setLines] = useState(initialLines)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [statsModal, setStatsModal] = useState<StatsModal | null>(null)

  async function handleRemoveFront(lineId: string) {
    if (!confirm("Remove the person at the front of the line?")) return

    setLoadingAction(`remove-${lineId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}/remove-front`, {
        method: "POST",
      })
      if (res.ok) {
        router.refresh()
      } else {
        const data = await res.json()
        alert(data.error || "Failed to remove person")
      }
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleDeleteLine(lineId: string) {
    if (!confirm("Are you sure you want to delete this line? This cannot be undone.")) return

    setLoadingAction(`delete-${lineId}`)
    try {
      const res = await fetch(`/api/lines/${lineId}`, {
        method: "DELETE",
      })
      if (res.ok) {
        setLines(lines.filter(l => l.id !== lineId))
      } else {
        const data = await res.json()
        alert(data.error || "Failed to delete line")
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
      } else {
        const data = await res.json()
        alert(data.error || "Failed to update")
      }
    } finally {
      setLoadingAction(null)
    }
  }

  function handleCopyLink(lineId: string) {
    const url = `${window.location.origin}/lines/${lineId}`
    navigator.clipboard.writeText(url)
    setCopiedId(lineId)
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
                          For sale: ${parseFloat(pos.askingPrice).toFixed(2)}
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
                  <div className="flex items-center justify-between">
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
                    <div className="flex items-center space-x-2 ml-4">
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
                      {line.frontPerson && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={(e) => {
                            e.preventDefault()
                            handleRemoveFront(line.id)
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
                          handleDeleteLine(line.id)
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
    </div>
  )
}
