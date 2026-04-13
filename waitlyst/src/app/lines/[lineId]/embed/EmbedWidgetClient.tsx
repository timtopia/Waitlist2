"use client"

import { useEffect, useState } from "react"

interface EmbedWidgetClientProps {
  lineId: string
  lineName: string
  productName: string | null
  productImage: string | null
  productPrice: number | null
  positionCount: number
  maxCapacity: number | null
  opensAt: string | null
  closesAt: string | null
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "0s"

  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((ms % (1000 * 60)) / 1000)

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price)
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

export function EmbedWidgetClient({
  lineId,
  lineName,
  productName,
  productImage,
  productPrice,
  positionCount,
  maxCapacity,
  opensAt,
  closesAt,
}: EmbedWidgetClientProps) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const status = getLineStatus(opensAt, closesAt, maxCapacity, positionCount)
  const lineUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/lines/${lineId}`

  const canJoin = status.state === "open" || status.state === "not_yet_open"

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Main content */}
      <div className="flex-1 overflow-auto p-4">
        {/* Product Image */}
        {productImage && (
          <div className="w-full aspect-[16/9] rounded-lg overflow-hidden mb-3 bg-gray-100">
            <img
              src={productImage}
              alt={productName || lineName}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Line Info */}
        <div className="mb-3">
          <h1 className="text-lg font-bold text-gray-900 leading-tight">
            {lineName}
          </h1>
          {productName && (
            <p className="text-sm text-gray-500 mt-0.5">{productName}</p>
          )}
          {productPrice != null && (
            <p className="text-sm font-semibold text-gray-700 mt-0.5">
              {formatPrice(productPrice)}
            </p>
          )}
        </div>

        {/* Status Section */}
        {status.state === "not_yet_open" && (() => {
          const msLeft = status.opensAt.getTime() - now.getTime()
          return (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-amber-800">
                    Opens Soon
                  </p>
                  <p className="text-xs text-amber-600">
                    {status.opensAt.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-amber-800 tabular-nums">
                    {formatTimeLeft(msLeft)}
                  </p>
                  <p className="text-xs text-amber-600">until open</p>
                </div>
              </div>
            </div>
          )
        })()}

        {status.state === "open" && status.closesAt && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-800">Open Now</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-green-800 tabular-nums">
                  {formatTimeLeft(status.closesAt.getTime() - now.getTime())}
                </p>
                <p className="text-xs text-green-600">remaining</p>
              </div>
            </div>
          </div>
        )}

        {status.state === "closed" && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
            <p className="text-sm font-semibold text-red-800">Line Closed</p>
            <p className="text-xs text-red-600">
              No longer accepting new joins.
            </p>
          </div>
        )}

        {status.state === "full" && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
            <p className="text-sm font-semibold text-red-800">Line Full</p>
            <p className="text-xs text-red-600">
              All {maxCapacity} spots have been taken.
            </p>
          </div>
        )}

        {/* Capacity Bar */}
        {maxCapacity && status.state !== "closed" ? (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">
                Spots Filled
              </span>
              <span className="text-xs font-bold text-gray-900">
                {positionCount} / {maxCapacity}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${
                  positionCount >= maxCapacity
                    ? "bg-red-500"
                    : positionCount >= maxCapacity * 0.8
                    ? "bg-amber-500"
                    : "bg-blue-500"
                }`}
                style={{
                  width: `${Math.min(
                    (positionCount / maxCapacity) * 100,
                    100
                  )}%`,
                }}
              />
            </div>
            {positionCount < maxCapacity && (
              <p className="text-xs text-gray-400 mt-1">
                {maxCapacity - positionCount} spot
                {maxCapacity - positionCount !== 1 ? "s" : ""} remaining
              </p>
            )}
          </div>
        ) : !maxCapacity ? (
          <div className="mb-3">
            <p className="text-xs text-gray-500">
              {positionCount} {positionCount === 1 ? "person" : "people"} in
              line
            </p>
          </div>
        ) : null}

        {/* Join Button */}
        <a
          href={lineUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`block w-full text-center py-2.5 rounded-lg font-semibold text-sm transition-colors ${
            canJoin
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-gray-200 text-gray-500 cursor-not-allowed pointer-events-none"
          }`}
        >
          {status.state === "not_yet_open"
            ? "View Line"
            : status.state === "closed"
            ? "Line Closed"
            : status.state === "full"
            ? "Line Full"
            : "Join Line"}
        </a>
      </div>

      {/* Powered by footer */}
      <div className="px-4 py-2 border-t border-gray-100">
        <a
          href={typeof window !== "undefined" ? window.location.origin : "/"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-gray-500 transition-colors"
        >
          Powered by
          <span className="font-semibold">Waitlyst</span>
        </a>
      </div>
    </div>
  )
}
