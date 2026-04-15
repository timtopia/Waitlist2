"use client"

import { useEffect, useState } from "react"
import { formatTimeLeft } from "@/lib/format"

interface LineStatusBannerProps {
  opensAt: string | null
  closesAt: string | null
  maxCapacity: number | null
  currentCount: number
  hideCapacity?: boolean
}

type LineStatus =
  | { state: "not_yet_open"; opensAt: Date }
  | { state: "open"; closesAt: Date | null }
  | { state: "closed" }
  | { state: "full" }

function getLineStatus(
  opensAt: string | null,
  closesAt: string | null,
  maxCapacity: number | null,
  currentCount: number
): LineStatus {
  const now = new Date()

  if (opensAt && now < new Date(opensAt)) {
    return { state: "not_yet_open", opensAt: new Date(opensAt) }
  }

  if (closesAt && now > new Date(closesAt)) {
    return { state: "closed" }
  }

  if (maxCapacity && currentCount >= maxCapacity) {
    return { state: "full" }
  }

  return { state: "open", closesAt: closesAt ? new Date(closesAt) : null }
}

export function LineStatusBanner({ opensAt, closesAt, maxCapacity, currentCount, hideCapacity = false }: LineStatusBannerProps) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const status = getLineStatus(opensAt, closesAt, maxCapacity, currentCount)

  return (
    <div className="space-y-3">
      {/* Status Banner */}
      {status.state === "not_yet_open" && (() => {
        const msLeft = status.opensAt.getTime() - now.getTime()
        const isUnderHour = msLeft < 60 * 60 * 1000
        const isUnder5Min = msLeft < 5 * 60 * 1000
        const isUnder30Min = msLeft < 30 * 60 * 1000

        const bannerClasses = isUnder5Min
          ? "bg-red-50 border border-red-300 rounded-lg p-4"
          : isUnderHour
          ? "bg-amber-50 border border-amber-200 rounded-lg p-4 animate-pulse"
          : "bg-amber-50 border border-amber-200 rounded-lg p-4"

        const titleClasses = isUnder5Min
          ? "font-bold text-red-700 text-lg"
          : "font-semibold text-amber-800"

        const subtitleClasses = isUnder5Min
          ? "text-sm text-red-500"
          : "text-sm text-amber-600"

        const countdownClasses = isUnder5Min
          ? "text-3xl font-extrabold text-red-700 tabular-nums"
          : "text-2xl font-bold text-amber-800 tabular-nums"

        const labelClasses = isUnder5Min
          ? "text-xs text-red-500 font-medium"
          : "text-xs text-amber-600"

        const prefix = isUnder30Min ? "\u{1F525} Drop starts in..." : "Line Not Yet Open"

        return (
          <div className={bannerClasses}>
            <div className="flex items-center justify-between">
              <div>
                <p className={titleClasses}>{prefix}</p>
                <p className={subtitleClasses}>
                  Opens {status.opensAt.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <div className="text-right">
                <p className={countdownClasses}>
                  {formatTimeLeft(msLeft)}
                </p>
                <p className={labelClasses}>until open</p>
              </div>
            </div>
          </div>
        )
      })()}

      {status.state === "open" && status.closesAt && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-green-800">Line is Open</p>
              <p className="text-sm text-green-600">
                Closes {status.closesAt.toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-green-800 tabular-nums">
                {formatTimeLeft(status.closesAt.getTime() - now.getTime())}
              </p>
              <p className="text-xs text-green-600">remaining</p>
            </div>
          </div>
        </div>
      )}

      {status.state === "closed" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="font-semibold text-red-800">Line is Closed</p>
          <p className="text-sm text-red-600">This line is no longer accepting new joins.</p>
        </div>
      )}

      {status.state === "full" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="font-semibold text-red-800">Line is Full</p>
          <p className="text-sm text-red-600">
            {hideCapacity ? "All spots have been taken." : `All ${maxCapacity} spots have been taken.`}
          </p>
        </div>
      )}

      {/* Capacity Bar */}
      {maxCapacity && status.state !== "closed" && !hideCapacity && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">Spots Filled</p>
            <p className="text-sm font-bold text-gray-900">
              {currentCount} / {maxCapacity}
            </p>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all duration-500 ${
                currentCount >= maxCapacity
                  ? "bg-red-500"
                  : currentCount >= maxCapacity * 0.8
                  ? "bg-amber-500"
                  : "bg-blue-500"
              }`}
              style={{ width: `${Math.min((currentCount / maxCapacity) * 100, 100)}%` }}
            />
          </div>
          {currentCount < maxCapacity && (
            <p className="text-xs text-gray-500 mt-1">
              {maxCapacity - currentCount} spot{maxCapacity - currentCount !== 1 ? "s" : ""} remaining
            </p>
          )}
        </div>
      )}

      {/* Hidden capacity indicator */}
      {maxCapacity && status.state !== "closed" && status.state !== "full" && hideCapacity && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm font-medium text-gray-700">Limited capacity</p>
        </div>
      )}
    </div>
  )
}
