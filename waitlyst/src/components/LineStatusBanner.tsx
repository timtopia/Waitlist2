"use client"

import { useEffect, useState } from "react"
import { formatTimeLeft } from "@/lib/format"
import { capacityUnit } from "@/lib/capacity"

interface LineStatusBannerProps {
  opensAt: string | null
  closesAt: string | null
  /** null when there's no limit or it's hidden from this viewer */
  maxCapacity: number | null
  currentCount: number
  isFull: boolean
  /** The line has a limit this viewer isn't shown */
  hideCapacity?: boolean
  /** Restaurant lines count capacity in guests rather than spots */
  kind?: "STANDARD" | "RESTAURANT"
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

export function LineStatusBanner({ opensAt, closesAt, maxCapacity, currentCount, isFull, hideCapacity = false, kind = "STANDARD" }: LineStatusBannerProps) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const status = getLineStatus(opensAt, closesAt, isFull)

  return (
    <div className="space-y-3">
      {/* Status Banner */}
      {status.state === "not_yet_open" && (() => {
        const msLeft = status.opensAt.getTime() - now.getTime()
        const isUnderHour = msLeft < 60 * 60 * 1000
        const isUnder5Min = msLeft < 5 * 60 * 1000
        const isUnder30Min = msLeft < 30 * 60 * 1000

        const bannerClasses = isUnder5Min
          ? "border border-rule border-l-2 border-l-accent bg-white px-4 py-3"
          : isUnderHour
          ? "border border-rule border-l-2 border-l-amber-600 bg-white px-4 py-3 animate-pulse"
          : "border border-rule border-l-2 border-l-amber-600 bg-white px-4 py-3"

        const titleClasses = isUnder5Min
          ? "font-mono text-xs uppercase tracking-widest text-accent"
          : "font-mono text-xs uppercase tracking-widest text-amber-700"

        const subtitleClasses = "text-sm text-ink/60 mt-1"

        const countdownClasses = isUnder5Min
          ? "font-mono text-3xl tabular-nums text-accent"
          : "font-mono text-2xl tabular-nums text-ink"

        const labelClasses = "font-mono text-xs uppercase tracking-widest text-ink/60 mt-0.5"

        const prefix = isUnder30Min ? "Opens in..." : "Line Not Yet Open"

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
        <div className="border border-rule border-l-2 border-l-green-700 bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-green-700">Line is Open</p>
              <p className="text-sm text-ink/60 mt-1">
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
              <p className="font-mono text-2xl tabular-nums text-ink">
                {formatTimeLeft(status.closesAt.getTime() - now.getTime())}
              </p>
              <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mt-0.5">remaining</p>
            </div>
          </div>
        </div>
      )}

      {status.state === "closed" && (
        <div className="border border-rule border-l-2 border-l-accent bg-white px-4 py-3">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Line is Closed</p>
          <p className="text-sm text-ink/60 mt-1">This line is no longer accepting new joins.</p>
        </div>
      )}

      {status.state === "full" && (
        <div className="border border-rule border-l-2 border-l-accent bg-white px-4 py-3">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Line is Full</p>
          <p className="text-sm text-ink/60 mt-1">
            {maxCapacity === null ? `All ${capacityUnit(kind, 2)} have been taken.` : `All ${maxCapacity} ${capacityUnit(kind, maxCapacity)} have been taken.`}
          </p>
        </div>
      )}

      {/* Capacity Bar */}
      {maxCapacity !== null && status.state !== "closed" && (
        <div className="bg-white border border-rule px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="font-mono text-xs uppercase tracking-widest text-ink/60">{kind === "RESTAURANT" ? "Guests" : "Spots Filled"}</p>
            <p className="font-mono text-sm tabular-nums text-ink">
              {currentCount} / {maxCapacity}
            </p>
          </div>
          <div className="w-full bg-ink/10 h-2">
            <div
              className={`h-2 transition-all duration-500 ${
                currentCount >= maxCapacity
                  ? "bg-accent"
                  : currentCount >= maxCapacity * 0.8
                  ? "bg-amber-600"
                  : "bg-ink"
              }`}
              style={{ width: `${Math.min((currentCount / maxCapacity) * 100, 100)}%` }}
            />
          </div>
          {currentCount < maxCapacity && (
            <p className="text-xs text-ink/60 mt-1.5">
              {maxCapacity - currentCount} {capacityUnit(kind, maxCapacity - currentCount)} remaining
            </p>
          )}
        </div>
      )}

      {/* Hidden capacity indicator */}
      {status.state !== "closed" && status.state !== "full" && hideCapacity && (
        <div className="bg-white border border-rule px-4 py-3">
          <p className="font-mono text-xs uppercase tracking-widest text-ink/60">Limited capacity</p>
        </div>
      )}
    </div>
  )
}
