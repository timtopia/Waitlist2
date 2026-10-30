"use client"

import { useEffect, useState } from "react"
import { capacityUnit } from "@/lib/capacity"

interface EmbedWidgetClientProps {
  lineId: string
  lineName: string
  productName: string | null
  productImage: string | null
  productPrice: number | null
  positionCount: number
  /** null when there's no limit or it's hidden */
  maxCapacity: number | null
  isFull: boolean
  opensAt: string | null
  closesAt: string | null
  nowServing: string | null
  /** The line has a limit that isn't shown */
  hideCapacity: boolean
  kind: "STANDARD" | "RESTAURANT"
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
  isFull: boolean
): LineStatus {
  const now = new Date()

  if (opensAt && now < new Date(opensAt)) {
    return { state: "not_yet_open", opensAt: new Date(opensAt) }
  }

  if (closesAt && now > new Date(closesAt)) {
    return { state: "closed" }
  }

  if (isFull) {
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
  isFull,
  opensAt,
  closesAt,
  nowServing,
  hideCapacity,
  kind,
}: EmbedWidgetClientProps) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const status = getLineStatus(opensAt, closesAt, isFull)
  const lineUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/lines/${lineId}`

  const canJoin = status.state === "open" || status.state === "not_yet_open"

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Main content */}
      <div className="flex-1 overflow-auto p-4">
        {/* Product Image */}
        {productImage && (
          <div className="w-full aspect-[16/9] overflow-hidden mb-3 bg-paper border border-rule">
            <img
              src={productImage}
              alt={productName || lineName}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Line Info */}
        <div className="mb-3">
          <h1 className="text-lg font-semibold tracking-tight leading-tight">
            {lineName}
          </h1>
          {productName && (
            <p className="text-sm text-ink/60 mt-0.5">{productName}</p>
          )}
          {productPrice != null && (
            <p className="font-mono text-sm tabular-nums text-ink/70 mt-0.5">
              {formatPrice(productPrice)}
            </p>
          )}
        </div>

        {/* Now Serving */}
        {nowServing && (
          <div className="bg-white border border-green-700 p-3 mb-3">
            <p className="text-sm font-semibold text-green-700">
              Now Serving: {nowServing}
            </p>
          </div>
        )}

        {/* Status Section */}
        {status.state === "not_yet_open" && (() => {
          const msLeft = status.opensAt.getTime() - now.getTime()
          return (
            <div className="bg-white border border-amber-600 p-3 mb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-amber-600">
                    Opens Soon
                  </p>
                  <p className="text-xs text-ink/50">
                    {status.opensAt.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg text-amber-600 tabular-nums">
                    {formatTimeLeft(msLeft)}
                  </p>
                  <p className="text-xs text-ink/50">until open</p>
                </div>
              </div>
            </div>
          )
        })()}

        {status.state === "open" && status.closesAt && (
          <div className="bg-white border border-green-700 p-3 mb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-700">Open Now</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg text-green-700 tabular-nums">
                  {formatTimeLeft(status.closesAt.getTime() - now.getTime())}
                </p>
                <p className="text-xs text-ink/50">remaining</p>
              </div>
            </div>
          </div>
        )}

        {status.state === "closed" && (
          <div className="bg-white border border-accent p-3 mb-3">
            <p className="text-sm font-semibold text-accent">Line Closed</p>
            <p className="text-xs text-ink/50">
              No longer accepting new joins.
            </p>
          </div>
        )}

        {status.state === "full" && (
          <div className="bg-white border border-accent p-3 mb-3">
            <p className="text-sm font-semibold text-accent">Line Full</p>
            <p className="text-xs text-ink/50">
              {maxCapacity === null ? `All ${capacityUnit(kind, 2)} have been taken.` : `All ${maxCapacity} ${capacityUnit(kind, maxCapacity)} have been taken.`}
            </p>
          </div>
        )}

        {/* Capacity Bar */}
        {maxCapacity !== null && status.state !== "closed" ? (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-xs uppercase tracking-widest text-ink/50">
                {kind === "RESTAURANT" ? "Guests" : "Spots Filled"}
              </span>
              <span className="font-mono text-xs tabular-nums text-ink">
                {positionCount} / {maxCapacity}
              </span>
            </div>
            <div className="w-full bg-ink/10 h-2">
              <div
                className={`h-2 transition-all duration-500 ${
                  positionCount >= maxCapacity
                    ? "bg-accent"
                    : positionCount >= maxCapacity * 0.8
                    ? "bg-amber-600"
                    : "bg-ink"
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
              <p className="text-xs text-ink/40 mt-1">
                {maxCapacity - positionCount} {capacityUnit(kind, maxCapacity - positionCount)} remaining
              </p>
            )}
          </div>
        ) : status.state !== "closed" && hideCapacity ? (
          <div className="mb-3">
            <p className="text-xs text-ink/50">Limited spots available</p>
          </div>
        ) : maxCapacity === null && !hideCapacity ? (
          <div className="mb-3">
            <p className="text-xs text-ink/50">
              {positionCount} {positionCount === 1 ? "person" : "people"} waiting
            </p>
          </div>
        ) : null}

        {/* Join Button */}
        <a
          href={lineUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`block w-full text-center py-2.5 font-semibold text-sm transition-colors ${
            canJoin
              ? "bg-ink text-paper hover:bg-accent"
              : "bg-ink/10 text-ink/40 cursor-not-allowed pointer-events-none"
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
      <div className="px-4 py-2 border-t border-rule">
        <a
          href={typeof window !== "undefined" ? window.location.origin : "/"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 font-mono text-xs uppercase tracking-widest text-ink/40 hover:text-ink/60 transition-colors"
        >
          Powered by
          <span className="font-semibold">Waitlyst</span>
        </a>
      </div>
    </div>
  )
}
