"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { BarChart, type Bar } from "@/components/BarChart"
import { formatCurrency } from "@/lib/format"

interface Visit {
  joinedAt: string
  servedAt: string | null
  outcome: "SERVED" | "LEFT" | "REMOVED" | "NO_SHOW" | "WAITING"
  partySize: number
}

interface Swap {
  at: string
  ownerFee: number
  buyerPaid: number
}

interface Data {
  days: number
  visits: Visit[]
  swaps: Swap[]
}

const RECENT_DAYS = 30

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function hourLabel(h: number): string {
  const suffix = h < 12 ? "a" : "p"
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`
}

/** Local calendar day key, so "per day" follows the owner's time zone */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function lastDays(n: number): Date[] {
  const out: Date[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // Step by calendar day: subtracting 24h lands on 23:00 the day before
  // across a daylight-saving change, shifting every earlier bar a day
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    out.push(d)
  }
  return out
}

export function AnalyticsClient({
  lineId,
  lineName,
  isRestaurant,
  allowResale,
}: {
  lineId: string
  lineName: string
  isRestaurant: boolean
  allowResale: boolean
}) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`/api/lines/${lineId}/analytics`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true))
  }, [lineId])

  const view = useMemo(() => {
    if (!data) return null
    const served = data.visits.filter((v) => v.outcome === "SERVED" && v.servedAt)
    const waits = served.map((v) => (new Date(v.servedAt!).getTime() - new Date(v.joinedAt).getTime()) / 60_000)
    const noShows = data.visits.filter((v) => v.outcome === "NO_SHOW").length
    const ownerFees = data.swaps.reduce((sum, s) => sum + s.ownerFee, 0)

    // When people join, by hour of the day in the owner's time zone
    const byHour = Array.from({ length: 24 }, () => 0)
    for (const v of data.visits) byHour[new Date(v.joinedAt).getHours()]++
    const hours: Bar[] = byHour.map((count, h) => ({
      label: hourLabel(h),
      value: count,
      display: `${count} ${count === 1 ? "join" : "joins"}`,
    }))

    // Served (or seated) per day, last 30 days
    const servedPerDay = new Map<string, number>()
    const guestsPerDay = new Map<string, number>()
    for (const v of served) {
      const k = dayKey(new Date(v.servedAt!))
      servedPerDay.set(k, (servedPerDay.get(k) ?? 0) + 1)
      guestsPerDay.set(k, (guestsPerDay.get(k) ?? 0) + v.partySize)
    }
    const days = lastDays(RECENT_DAYS)
    const dayLabel = (d: Date) => d.toLocaleDateString([], { month: "short", day: "numeric" })
    const perDay: Bar[] = days.map((d) => {
      const count = servedPerDay.get(dayKey(d)) ?? 0
      if (!isRestaurant) return { label: dayLabel(d), value: count, display: `${count} served` }
      // Covers matter as much as parties to a restaurant
      const guests = guestsPerDay.get(dayKey(d)) ?? 0
      return { label: dayLabel(d), value: count, display: `${count} seated (${guests} ${guests === 1 ? "guest" : "guests"})` }
    })

    // Swap fees earned per day, last 30 days
    const feesPerDay = new Map<string, number>()
    for (const s of data.swaps) {
      const k = dayKey(new Date(s.at))
      feesPerDay.set(k, (feesPerDay.get(k) ?? 0) + s.ownerFee)
    }
    const fees: Bar[] = days.map((d) => {
      const amount = feesPerDay.get(dayKey(d)) ?? 0
      return { label: dayLabel(d), value: amount, display: formatCurrency(amount) }
    })

    // Typical wait by party size (restaurants)
    const bySize = new Map<number, number[]>()
    for (let i = 0; i < served.length; i++) {
      const size = Math.min(served[i].partySize, 8) // 8+ grouped together
      bySize.set(size, [...(bySize.get(size) ?? []), waits[i]])
    }
    const sizes: Bar[] = [...bySize.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([size, w]) => {
        const m = Math.round(median(w) ?? 0)
        return {
          label: size === 8 ? "8+" : String(size),
          value: m,
          display: `${m} min typical (${w.length} ${w.length === 1 ? "party" : "parties"})`,
        }
      })

    return {
      servedCount: served.length,
      guestsServed: served.reduce((sum, v) => sum + v.partySize, 0),
      medianWait: median(waits),
      noShowRate: served.length + noShows > 0 ? noShows / (served.length + noShows) : null,
      noShows,
      ownerFees,
      swapCount: data.swaps.length,
      hours,
      perDay,
      fees,
      sizes,
    }
  }, [data, isRestaurant])

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link
        href={`/lines/${lineId}`}
        className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4 mb-2 inline-block"
      >
        &larr; Back to line
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Analytics &mdash; {lineName}</h1>
      <p className="text-sm text-ink/60 mt-1 mb-6">
        The last {data?.days ?? 90} days, in your time zone.
      </p>

      {error && <p className="text-sm text-accent">Couldn&apos;t load analytics. Please refresh to try again.</p>}
      {!data && !error && <p className="text-sm text-ink/60">Loading…</p>}

      {view && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label={isRestaurant ? "Parties seated" : "People served"}
              value={view.servedCount.toLocaleString()}
              note={isRestaurant ? `${view.guestsServed.toLocaleString()} guests` : undefined}
            />
            <Stat
              label="Typical wait"
              value={view.medianWait === null ? "--" : `${Math.round(view.medianWait)} min`}
            />
            <Stat
              label="No-show rate"
              value={view.noShowRate === null ? "--" : `${Math.round(view.noShowRate * 100)}%`}
              note={view.noShows > 0 ? `${view.noShows} no-show${view.noShows === 1 ? "" : "s"}` : undefined}
            />
            {allowResale || view.swapCount > 0 ? (
              <Stat label="Swap fees earned" value={formatCurrency(view.ownerFees)} note={`${view.swapCount} swap${view.swapCount === 1 ? "" : "s"}`} />
            ) : (
              <Stat label="Joined" value={view.hours.reduce((s, h) => s + h.value, 0).toLocaleString()} />
            )}
          </div>

          {view.servedCount === 0 && view.hours.every((h) => h.value === 0) ? (
            <p className="text-sm text-ink/60">
              No one has come through this line yet. Charts appear once people start joining.
            </p>
          ) : (
            <>
              <BarChart
                title="Busiest hours"
                subtitle="When people join, by hour of the day"
                bars={view.hours}
                labelHeader="Hour"
                valueHeader="Joins"
                labelEvery={3}
              />
              <BarChart
                title={isRestaurant ? "Parties seated per day" : "People served per day"}
                subtitle={`Last ${RECENT_DAYS} days`}
                bars={view.perDay}
                labelHeader="Day"
                valueHeader={isRestaurant ? "Seated" : "Served"}
                labelEvery={5}
              />
              {isRestaurant && view.sizes.length > 0 && (
                <BarChart
                  title="Typical wait by party size"
                  subtitle="Median minutes from joining to being seated"
                  bars={view.sizes}
                  labelHeader="Party size"
                  valueHeader="Typical wait"
                  formatTick={(v) => `${Math.round(v)}m`}
                />
              )}
              {(allowResale || view.swapCount > 0) && (
                <BarChart
                  title="Swap fees earned per day"
                  subtitle={`Your fee on paid swaps, last ${RECENT_DAYS} days`}
                  bars={view.fees}
                  labelHeader="Day"
                  valueHeader="Fees"
                  labelEvery={5}
                  formatTick={(v) => `$${Math.round(v)}`}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border border-rule bg-white p-3">
      <p className="text-xs text-ink/60">{label}</p>
      <p className="text-2xl font-semibold tracking-tight text-ink mt-1">{value}</p>
      {note && <p className="text-xs text-ink/60 mt-0.5">{note}</p>}
    </div>
  )
}
