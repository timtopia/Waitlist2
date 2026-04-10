"use client"

import { useEffect, useState, useCallback } from "react"
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
import { useToast } from "@/components/ui/Toast"
import { useLineUpdates, LineUpdateEvent } from "@/hooks/useLineUpdates"
import { useNotifications } from "@/hooks/useNotifications"

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

export function LineDetailClient({ lineId }: { lineId: string }) {
  const { data: session, status } = useSession()
  const [line, setLine] = useState<Line | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
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

  const handleLineUpdate = useCallback((event: LineUpdateEvent) => {
    if (event.type === "poll-update" && event.data) {
      // Poll detected a change — use the fresh data directly (no extra fetch)
      setLine(event.data as Line)
      return
    }

    // SSE event — refetch and notify
    fetchLine()

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
  }, [fetchLine, sendNotification, line?.name])

  // Subscribe to real-time updates
  useLineUpdates(lineId, handleLineUpdate)

  const isInLine = line?.positions.some((p) => p.user.id === session?.user?.id)
  const isCreator = line?.createdBy.id === session?.user?.id

  const now = new Date()
  const lineNotYetOpen = line?.opensAt && now < new Date(line.opensAt)
  const lineClosed = line?.closesAt && now > new Date(line.closesAt)
  const lineFull = line?.maxCapacity ? line.positions.length >= line.maxCapacity : false
  const canJoin = !isInLine && !isCreator && !lineNotYetOpen && !lineClosed && !lineFull

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
                  <span className="text-sm text-blue-600 font-medium bg-blue-50 px-3 py-1 rounded-full">
                    Your Line
                  </span>
                  <Link href={`/lines/${lineId}/edit`}>
                    <Button variant="secondary" size="sm">
                      Edit
                    </Button>
                  </Link>
                  <Button variant="danger" size="sm" onClick={() => setShowDeleteConfirm(true)} isLoading={deleting}>
                    Delete
                  </Button>
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

      {/* Status Banner */}
      {(line.opensAt || line.closesAt || line.maxCapacity) && (
        <div className="mb-6">
          <LineStatusBanner
            opensAt={line.opensAt}
            closesAt={line.closesAt}
            maxCapacity={line.maxCapacity}
            currentCount={line.positions.length}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-gray-900">
            Queue ({line.positions.length} {line.positions.length === 1 ? "person" : "people"})
          </h2>
        </CardHeader>
        <CardContent>
          <QueueDisplay
            lineId={line.id}
            positions={line.positions}
            onRefresh={fetchLine}
            isCreator={isCreator}
            feeInfo={feeInfo}
          />
        </CardContent>
      </Card>
    </div>
  )
}
