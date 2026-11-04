"use client"

import { useEffect, useState } from "react"
import { capacityUnit } from "@/lib/capacity"
import { timeoutSignal } from "@/lib/timeout-signal"

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
  isActive: boolean
  /** Capacity used as the server counts it */
  capacityUsed: number
}

/** The parts of the line that change while the widget is open */
interface LiveState {
  positionCount: number
  capacityUsed: number
  maxCapacity: number | null
  isFull: boolean
  isActive: boolean
  nowServing: string | null
  opensAt: string | null
  closesAt: string | null
}

const REFRESH_MS = 30_000

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
  }).format(price)
}

type LineStatus =
  | { state: "not_yet_open"; opensAt: Date }
  | { state: "open"; closesAt: Date | null }
  | { state: "closed" }
  | { state: "full" }
  | { state: "paused" }

function getLineStatus(
  opensAt: string | null,
  closesAt: string | null,
  isFull: boolean,
  isActive: boolean
): LineStatus {
  const now = new Date()

  // Past its closing time it's closed, paused or not
  if (closesAt && now > new Date(closesAt)) {
    return { state: "closed" }
  }

  if (!isActive) {
    return { state: "paused" }
  }

  if (opensAt && now < new Date(opensAt)) {
    return { state: "not_yet_open", opensAt: new Date(opensAt) }
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
  hideCapacity,
  kind,
  ...initial
}: EmbedWidgetClientProps) {
  const [now, setNow] = useState(new Date())
  const [live, setLive] = useState<LiveState>({
    positionCount: initial.positionCount,
    capacityUsed: initial.capacityUsed,
    maxCapacity: initial.maxCapacity,
    isFull: initial.isFull,
    isActive: initial.isActive,
    nowServing: initial.nowServing,
    opensAt: initial.opensAt,
    closesAt: initial.closesAt,
  })
  // The owner deleted the line: stop offering a Join button that 404s
  const [gone, setGone] = useState(false)
  // Set when a refresh fails, so a stale count isn't passed off as live
  const [staleSince, setStaleSince] = useState<Date | null>(null)
  const { positionCount, capacityUsed, maxCapacity, isFull, isActive, nowServing, opensAt, closesAt } = live

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  // The page is rendered once on the server; keep the count, "full",
  // "paused" and "now serving" current while it sits on someone's site.
  useEffect(() => {
    // Every visitor to the host's site polls; back off when told to
    let pausedUntil = 0
    async function refresh() {
      if (document.visibilityState !== "visible" || Date.now() < pausedUntil) return
      try {
        const res = await fetch(`/api/lines/${lineId}`, { signal: timeoutSignal(10_000) })
        if (res.status === 404) {
          setGone(true)
          return
        }
        if (!res.ok) {
          const retryAfter = Number(res.headers.get("Retry-After"))
          if (res.status === 429 || res.status >= 500) pausedUntil = Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 60_000)
          setStaleSince((s) => s ?? new Date())
          return
        }
        const line = await res.json()
        setStaleSince(null)
        setLive({
          positionCount: (line.positions ?? []).reduce(
            (sum: number, p: { partySize?: number; fulfilled?: boolean }) => sum + (p.fulfilled ? 0 : p.partySize ?? 1),
            0
          ),
          capacityUsed: line.capacityUsed,
          maxCapacity: line.maxCapacity,
          isFull: line.isFull,
          isActive: line.isActive,
          nowServing: line.nowServing,
          opensAt: line.opensAt,
          closesAt: line.closesAt,
        })
      } catch {
        // Keep showing the last known state, but say it may be out of date
        setStaleSince((s) => s ?? new Date())
      }
    }
    const interval = setInterval(refresh, REFRESH_MS)
    // Coming back to a backgrounded tab shouldn't wait a full interval
    const onVisible = () => { if (document.visibilityState === "visible") void refresh() }
    document.addEventListener("visibilitychange", onVisible)
    // Back online: a back-off set during the outage shouldn't hold it stale
    const onOnline = () => { pausedUntil = 0; void refresh() }
    window.addEventListener("online", onOnline)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("online", onOnline)
    }
  }, [lineId])

  const status = getLineStatus(opensAt, closesAt, isFull, isActive)
  const lineUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/lines/${lineId}`

  // A paused line can still be viewed; joining waits until it resumes
  const canJoin = status.state === "open" || status.state === "not_yet_open" || status.state === "paused"

  if (gone) {
    return (
      <main className="flex items-center justify-center h-screen bg-white p-4">
        {/* Deleted, not just closed by schedule: there's nothing to come back to */}
        <p className="text-sm text-ink/60" role="status">This line is no longer available.</p>
      </main>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Main content: a landmark, since this page has no site chrome */}
      <main className="flex-1 overflow-auto p-4">
        {/* Product Image */}
        {productImage && (
          <div className="w-full aspect-[2/1] overflow-hidden mb-3 bg-paper border border-rule">
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
        {/* Guests watch this from the restaurant's site; announce when the
            refresh moves it on */}
        {/* The live region stays mounted: one inserted together with its
            text isn't announced by most screen readers */}
        <div aria-live="polite" aria-atomic="true">
          {nowServing && (
            <div className="bg-white border border-green-700 p-3 mb-3">
              <p className="text-sm font-semibold text-green-700">
                Now Serving: {nowServing}
              </p>
            </div>
          )}
        </div>
        <p className={staleSince ? "text-xs text-amber-700 mb-2" : "sr-only"} role="status">
          {staleSince
            ? `Couldn't update. Showing info from ${staleSince.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`
            : ""}
        </p>

        {/* Announces status changes picked up by the refresh (not the
            ticking countdowns) to screen readers */}
        <p className="sr-only" aria-live="polite">
          {status.state === "not_yet_open"
            ? "Opens soon"
            : status.state === "paused"
            ? "Line paused"
            : status.state === "closed"
            ? "Line closed"
            : status.state === "full"
            ? "Line full"
            : "Line open"}
        </p>

        {/* Status Section */}
        {status.state === "not_yet_open" && (() => {
          const msLeft = status.opensAt.getTime() - now.getTime()
          return (
            <div className="bg-white border border-amber-600 p-3 mb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-amber-700">
                    Opening
                  </p>
                  <p className="text-xs text-ink/60">
                    {status.opensAt.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg text-amber-700 tabular-nums">
                    {formatTimeLeft(msLeft)}
                  </p>
                  <p className="text-xs text-ink/60">until open</p>
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
                <p className="text-xs text-ink/60">remaining</p>
              </div>
            </div>
          </div>
        )}

        {status.state === "paused" && (
          <div className="bg-white border border-amber-600 p-3 mb-3">
            <p className="text-sm font-semibold text-amber-700">Paused</p>
            <p className="text-xs text-ink/60">
              Not taking new joins right now.
            </p>
          </div>
        )}

        {status.state === "closed" && (
          <div className="bg-white border border-accent p-3 mb-3">
            <p className="text-sm font-semibold text-accent">Line Closed</p>
            <p className="text-xs text-ink/60">
              No longer accepting new joins.
            </p>
          </div>
        )}

        {status.state === "full" && (
          <div className="bg-white border border-accent p-3 mb-3">
            <p className="text-sm font-semibold text-accent">Line Full</p>
            <p className="text-xs text-ink/60">
              {maxCapacity === null ? `All ${capacityUnit(kind, 2)} have been taken.` : `All ${maxCapacity} ${capacityUnit(kind, maxCapacity)} have been taken.`}
            </p>
          </div>
        )}

        {/* Capacity Bar */}
        {maxCapacity !== null && status.state !== "closed" ? (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
                {kind === "RESTAURANT" ? "Guests" : "Spots Filled"}
              </span>
              <span className="font-mono text-xs tabular-nums text-ink">
                {capacityUsed} / {maxCapacity}
              </span>
            </div>
            <div className="w-full bg-ink/10 h-2" aria-hidden="true">
              <div
                className={`h-2 transition-all duration-500 ${
                  capacityUsed >= maxCapacity
                    ? "bg-accent"
                    : capacityUsed >= maxCapacity * 0.8
                    ? "bg-amber-600"
                    : "bg-ink"
                }`}
                style={{
                  width: `${Math.min(
                    (capacityUsed / maxCapacity) * 100,
                    100
                  )}%`,
                }}
              />
            </div>
            {capacityUsed < maxCapacity && (
              <p className="text-xs text-ink/60 mt-1">
                {maxCapacity - capacityUsed} {capacityUnit(kind, maxCapacity - capacityUsed)} remaining
              </p>
            )}
          </div>
        ) : status.state !== "closed" && status.state !== "full" && hideCapacity ? (
          <div className="mb-3">
            <p className="text-xs text-ink/60">Limited spots available</p>
          </div>
        ) : maxCapacity === null && !hideCapacity ? (
          <div className="mb-3">
            <p className="text-xs text-ink/60">
              {positionCount} {positionCount === 1 ? "person" : "people"} waiting
            </p>
          </div>
        ) : null}

        {/* Join Button */}
        {/* Without an href a full/closed line's button can't be focused or
            activated by keyboard either, not just by pointer */}
        <a
          href={canJoin ? lineUrl : undefined}
          aria-disabled={canJoin ? undefined : true}
          target="_blank"
          rel="noopener noreferrer"
          className={`block w-full text-center py-2.5 font-semibold text-sm transition-colors ${
            canJoin
              ? "bg-ink text-paper hover:bg-accent"
              : "bg-ink/10 text-ink/60 cursor-not-allowed pointer-events-none"
          }`}
        >
          {status.state === "not_yet_open" || status.state === "paused"
            ? "View Line"
            : status.state === "closed"
            ? "Line Closed"
            : status.state === "full"
            ? "Line Full"
            : "Join Line"}
          {canJoin && <span className="sr-only"> (opens in a new tab)</span>}
        </a>
      </main>

      {/* Powered by footer */}
      <div className="px-4 py-2 border-t border-rule">
        <a
          href={typeof window !== "undefined" ? window.location.origin : "/"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 font-mono text-xs uppercase tracking-widest text-ink/60 hover:text-ink transition-colors"
        >
          Powered by
          <span className="font-semibold">Waitlyst</span>
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
    </div>
  )
}
