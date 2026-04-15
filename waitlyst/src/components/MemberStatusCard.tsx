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
  let capacityIcon: React.ReactNode

  if (maxCapacity === null || hideCapacity) {
    // When capacity is hidden or unlimited, just show generic status
    if (hideCapacity && maxCapacity !== null && position > maxCapacity) {
      capacityLabel = "You're on the waitlist"
      capacityColor = "text-amber-700 bg-amber-50"
      capacityIcon = (
        <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      )
    } else if (hideCapacity && maxCapacity !== null && position <= maxCapacity) {
      capacityLabel = "Your spot is secured"
      capacityColor = "text-green-700 bg-green-50"
      capacityIcon = (
        <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )
    } else {
      capacityLabel = "You're in line"
      capacityColor = "text-blue-700 bg-blue-50"
      capacityIcon = (
        <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )
    }
  } else if (position <= maxCapacity) {
    capacityLabel = "Your spot is secured"
    capacityColor = "text-green-700 bg-green-50"
    capacityIcon = (
      <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
      </svg>
    )
  } else {
    capacityLabel = "You're on the waitlist"
    capacityColor = "text-amber-700 bg-amber-50"
    capacityIcon = (
      <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
    )
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
    <Card className="mb-6 border-l-4 border-l-blue-500 overflow-hidden">
      <div className="px-5 py-4 sm:px-6">
        <div className="flex items-center gap-4 sm:gap-6">
          {/* Large position badge */}
          <div className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-blue-600 text-white flex flex-col items-center justify-center">
            <span className="text-xs font-medium uppercase tracking-wide opacity-80 leading-none">#</span>
            <span className="text-2xl sm:text-3xl font-extrabold leading-none">{position}</span>
          </div>

          {/* Status details */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Capacity status */}
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${capacityColor}`}>
                {capacityIcon}
                {capacityLabel}
              </span>
            </div>

            {/* Wait time */}
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{waitTimeLabel}</span>
            </div>

            {/* Asking price status */}
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
              </svg>
              <span>{priceLabel}</span>
            </div>
          </div>
        </div>

        {/* Position within capacity context */}
        {maxCapacity !== null && !hideCapacity && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Position {position} of {totalPositions} in line</span>
              <span>{maxCapacity} spot{maxCapacity !== 1 ? "s" : ""} available</span>
            </div>
            <div className="mt-1.5 w-full bg-gray-100 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  position <= maxCapacity ? "bg-blue-500" : "bg-amber-400"
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
