"use client"

import { useEffect, useState, useCallback } from "react"
import { Card } from "@/components/ui/Card"
import { formatCurrency } from "@/lib/format"

interface MemberStatusCardProps {
  position: number
  maxCapacity: number | null
  totalPositions: number
  askingPrice: number | null
  lineId: string
  hideCapacity?: boolean
}

/** Format estimated wait time into a human-readable string */
function formatWaitTime(minutes: number): string {
  if (minutes < 1) return "<1 min"
  if (minutes < 60) return `~${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 2) return "~1 hr"
  return `~${Math.round(hours)} hrs`
}

export function MemberStatusCard({
  position,
  maxCapacity,
  totalPositions,
  askingPrice,
  lineId,
  hideCapacity = false,
}: MemberStatusCardProps) {
  const [waitTime, setWaitTime] = useState<{
    estimatedMinutesPerPerson: number | null
    basedOn: number
  } | null>(null)
  const [waitTimeLoading, setWaitTimeLoading] = useState(true)

  const fetchWaitTime = useCallback(async () => {
    try {
      const res = await fetch(`/api/lines/${lineId}/wait-time`)
      if (res.ok) {
        const data = await res.json()
        setWaitTime(data)
      }
    } catch {
      // Wait time is non-critical
    } finally {
      setWaitTimeLoading(false)
    }
  }, [lineId])

  useEffect(() => {
    fetchWaitTime()
  }, [fetchWaitTime])

  // Capacity status
  let capacityLabel: string
  let capacityColor: string
  let capacityDot: string

  if (maxCapacity === null || hideCapacity) {
    // When capacity is hidden or unlimited, just show generic status
    if (hideCapacity && maxCapacity !== null && position > maxCapacity) {
      capacityLabel = "You're on the waitlist"
      capacityColor = "text-amber-600"
      capacityDot = "bg-amber-600"
    } else if (hideCapacity && maxCapacity !== null && position <= maxCapacity) {
      capacityLabel = "Your spot is secured"
      capacityColor = "text-green-700"
      capacityDot = "bg-green-600"
    } else {
      capacityLabel = "You're in line"
      capacityColor = "text-ink"
      capacityDot = "bg-green-600"
    }
  } else if (position <= maxCapacity) {
    capacityLabel = "Your spot is secured"
    capacityColor = "text-green-700"
    capacityDot = "bg-green-600"
  } else {
    capacityLabel = "You're on the waitlist"
    capacityColor = "text-amber-600"
    capacityDot = "bg-amber-600"
  }

  // Wait time display
  let waitTimeLabel: string
  if (waitTimeLoading) {
    waitTimeLabel = "Calculating..."
  } else if (position === 1) {
    waitTimeLabel = "You're next!"
  } else if (waitTime?.estimatedMinutesPerPerson != null) {
    waitTimeLabel = `Est. wait: ${formatWaitTime(waitTime.estimatedMinutesPerPerson * (position - 1))}`
  } else {
    waitTimeLabel = "Not enough data to estimate"
  }

  // Asking price display
  const priceLabel = askingPrice !== null
    ? `Your position is listed for ${formatCurrency(askingPrice)}`
    : "Your position is not available for swap"

  return (
    <Card className="mb-6 border-l-2 border-l-accent overflow-hidden">
      <div className="px-5 py-4 sm:px-6">
        <div className="flex items-center gap-4 sm:gap-6">
          {/* Large position badge */}
          <div className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 bg-ink text-paper flex flex-col items-center justify-center">
            <span className="font-mono text-xs uppercase tracking-widest opacity-60 leading-none">#</span>
            <span className="font-mono tabular-nums text-2xl sm:text-3xl leading-none mt-1">{position}</span>
          </div>

          {/* Status details */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Capacity status */}
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest ${capacityColor}`}>
                <span className={`w-1.5 h-1.5 flex-shrink-0 ${capacityDot}`} aria-hidden />
                {capacityLabel}
              </span>
            </div>

            {/* Wait time */}
            <div className="flex items-center gap-2 text-sm text-ink/60">
              <span>{waitTimeLabel}</span>
            </div>

            {/* Asking price status */}
            <div className="flex items-center gap-2 text-sm text-ink/60">
              <span>{priceLabel}</span>
            </div>
          </div>
        </div>

        {/* Position within capacity context */}
        {maxCapacity !== null && !hideCapacity && (
          <div className="mt-3 pt-3 border-t border-rule">
            <div className="flex items-center justify-between font-mono text-xs uppercase tracking-widest text-ink/40 tabular-nums">
              <span>Position {position} of {totalPositions} in line</span>
              <span>{maxCapacity} spot{maxCapacity !== 1 ? "s" : ""} available</span>
            </div>
            <div className="mt-1.5 w-full bg-ink/10 h-1.5">
              <div
                className={`h-1.5 transition-all ${
                  position <= maxCapacity ? "bg-ink" : "bg-amber-600"
                }`}
                style={{ width: `${Math.min((position / maxCapacity) * 100, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
