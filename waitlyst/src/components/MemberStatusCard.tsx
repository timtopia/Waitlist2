"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/Card"
import { formatCurrency, timeAgo } from "@/lib/format"
import { formatWaitTime } from "@/lib/wait-time"
import type { MemberStatus } from "@/lib/member-status"

export type NotificationState = "unsupported" | "default" | "denied" | "granted"

interface MemberStatusCardProps {
  status: MemberStatus
  maxCapacity: number | null
  totalPositions: number
  askingPrice: number | null
  lineId: string
  hideCapacity?: boolean
  isPaused?: boolean
  calledAt?: string | null
  notificationPermission?: NotificationState
  onEnableNotifications?: () => void
}

export function MemberStatusCard({
  status,
  maxCapacity,
  totalPositions,
  askingPrice,
  lineId,
  hideCapacity = false,
  isPaused = false,
  calledAt = null,
  notificationPermission = "unsupported",
  onEnableNotifications,
}: MemberStatusCardProps) {
  const { phase, position, ahead } = status
  const [minutesPerPerson, setMinutesPerPerson] = useState<number | null>(null)
  const [waitTimeLoading, setWaitTimeLoading] = useState(true)

  // Refetch as the line moves: each service event changes the pace estimate.
  useEffect(() => {
    if (phase !== "waiting") return
    let cancelled = false
    fetch(`/api/lines/${lineId}/wait-time`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setMinutesPerPerson(data.estimatedMinutesPerPerson ?? null)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setWaitTimeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [lineId, ahead, phase])

  const pastCapacity = maxCapacity !== null && position > maxCapacity
  let capacityLabel: string | null = null
  let capacityColor = "text-ink"
  let capacityDot = "bg-green-600"
  if (maxCapacity !== null) {
    if (pastCapacity) {
      capacityLabel = "You're on the waitlist"
      capacityColor = "text-amber-600"
      capacityDot = "bg-amber-600"
    } else {
      capacityLabel = "Your spot is secured"
      capacityColor = "text-green-700"
    }
  }

  let headline: string
  let detail: string
  if (phase === "called") {
    headline = "It's your turn"
    detail = `The organizer called you${calledAt ? ` ${timeAgo(calledAt)}` : ""}. Head to the front now.`
  } else if (phase === "served") {
    headline = "You've been served"
    detail = "You're all set. Leave the line whenever you're ready."
  } else if (phase === "next") {
    headline = "You're next"
    detail = "No one is ahead of you. Stay close; you'll be called soon."
  } else {
    headline = `${ahead} ${ahead === 1 ? "person" : "people"} ahead of you`
    if (waitTimeLoading) detail = "Estimating your wait..."
    else if (minutesPerPerson != null) detail = `Est. wait: ${formatWaitTime(minutesPerPerson * ahead)}`
    else detail = "Wait estimate appears once the organizer starts serving people."
  }

  const accent = phase === "called"
  const done = phase === "served"

  return (
    <Card
      className={`mb-6 border-l-2 overflow-hidden ${
        accent ? "border-l-accent border-accent" : done ? "border-l-green-700" : "border-l-accent"
      }`}
    >
      <div className="px-5 py-4 sm:px-6" role="status" aria-live="polite">
        <div className="flex items-center gap-4 sm:gap-6">
          <div
            className={`flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 flex flex-col items-center justify-center ${
              accent ? "bg-accent text-paper" : done ? "bg-green-700 text-paper" : "bg-ink text-paper"
            }`}
          >
            <span className="font-mono text-xs uppercase tracking-widest opacity-60 leading-none">#</span>
            <span className="font-mono tabular-nums text-2xl sm:text-3xl leading-none mt-1">{position}</span>
          </div>

          <div className="flex-1 min-w-0 space-y-1.5">
            <p className="font-mono text-xs uppercase tracking-widest text-ink/50">Your place</p>
            <p className={`text-xl font-semibold tracking-tight ${accent ? "text-accent" : "text-ink"}`}>
              {headline}
            </p>
            <p className="text-sm text-ink/60">{detail}</p>
          </div>
        </div>

        {!done && (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink/60">
            {capacityLabel && (
              <span className={`inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest ${capacityColor}`}>
                <span className={`w-1.5 h-1.5 flex-shrink-0 ${capacityDot}`} aria-hidden />
                {capacityLabel}
              </span>
            )}
            <span>
              {askingPrice !== null
                ? `Your spot is listed for ${formatCurrency(askingPrice)}`
                : "Your spot isn't listed for swap"}
            </span>
          </div>
        )}

        {isPaused && !done && (
          <p className="mt-3 text-sm text-amber-700">
            The line is paused. You keep your place while it&apos;s paused.
          </p>
        )}

        {!done && notificationPermission !== "unsupported" && (
          <div className="mt-4 pt-3 border-t border-rule flex items-center justify-between gap-3">
            {notificationPermission === "granted" ? (
              <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-green-700">
                <span className="w-1.5 h-1.5 bg-green-600" aria-hidden />
                Alerts on. Keep this tab open.
              </span>
            ) : notificationPermission === "denied" ? (
              <span className="text-xs text-ink/50">
                Notifications are blocked for this site. Allow them in your browser settings to get alerted when it&apos;s your turn.
              </span>
            ) : (
              <>
                <span className="text-xs text-ink/50">Get an alert when it&apos;s your turn, even in another tab.</span>
                <button
                  onClick={onEnableNotifications}
                  className="flex-shrink-0 px-3 py-1.5 font-mono text-xs uppercase tracking-widest border border-ink text-ink hover:bg-ink hover:text-paper transition-colors"
                >
                  Turn on alerts
                </button>
              </>
            )}
          </div>
        )}

        {maxCapacity !== null && !hideCapacity && !done && (
          <div className="mt-3 pt-3 border-t border-rule">
            <div className="flex items-center justify-between font-mono text-xs uppercase tracking-widest text-ink/40 tabular-nums">
              <span>Position {position} of {totalPositions} in line</span>
              <span>
                {Math.max(maxCapacity - totalPositions, 0)} spot{maxCapacity - totalPositions !== 1 ? "s" : ""} left
              </span>
            </div>
            <div className="mt-1.5 w-full bg-ink/10 h-1.5">
              <div
                className={`h-1.5 transition-all ${pastCapacity ? "bg-amber-600" : "bg-ink"}`}
                style={{ width: `${Math.min((position / maxCapacity) * 100, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
