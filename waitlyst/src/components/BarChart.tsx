"use client"

import { useId, useState } from "react"

export interface Bar {
  label: string
  value: number
  /** Shown on hover/focus and in the table, e.g. "12 people" or "$34.50" */
  display: string
}

interface BarChartProps {
  title: string
  /** One line under the title saying what's plotted */
  subtitle?: string
  bars: Bar[]
  /** Column header for the label in the table view */
  labelHeader: string
  valueHeader: string
  /** Show every Nth axis label so they don't collide */
  labelEvery?: number
  formatTick?: (value: number) => string
}

// One series, so one hue (validated slot 1) and no legend: the title names it.
const SERIES = "#2a78d6"
const HEIGHT = 160
const BAR_MAX = 24
const PAD = { top: 8, right: 8, bottom: 22, left: 36 }

/** Round the axis top up to a tidy number so the ticks read well */
function niceMax(max: number): number {
  if (max <= 0) return 1
  const step = Math.pow(10, Math.floor(Math.log10(max)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= max) return m * step
  return 10 * step
}

/**
 * A single-series column chart: thin bars from one baseline, hairline grid,
 * a tooltip on hover or keyboard focus, and a table view for anyone who'd
 * rather read numbers.
 */
export function BarChart({ title, subtitle, bars, labelHeader, valueHeader, labelEvery = 1, formatTick = String }: BarChartProps) {
  const [active, setActive] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const titleId = useId()

  const width = 640
  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const top = niceMax(Math.max(0, ...bars.map((b) => b.value)))
  const band = plotW / Math.max(bars.length, 1)
  const barW = Math.min(BAR_MAX, band - 2) // 2px of surface between neighbours
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH
  const ticks = [0, top / 2, top]

  return (
    <figure className="border border-rule bg-white p-4" aria-labelledby={titleId}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <figcaption>
          <p id={titleId} className="text-sm font-semibold text-ink">{title}</p>
          {subtitle && <p className="text-xs text-ink/60">{subtitle}</p>}
        </figcaption>
        <button
          onClick={() => setAsTable(!asTable)}
          className="font-mono text-[10px] uppercase tracking-widest text-ink/60 hover:text-ink flex-shrink-0"
        >
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink/60">
                <th className="font-normal py-1">{labelHeader}</th>
                <th className="font-normal py-1 text-right">{valueHeader}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {bars.map((b) => (
                <tr key={b.label} className="border-t border-rule">
                  <td className="py-1 text-ink/70">{b.label}</td>
                  <td className="py-1 text-right text-ink">{b.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="w-full h-auto" role="img" aria-labelledby={titleId}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="#e7e4dc" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="#8a877f" className="tabular-nums">
                  {formatTick(t)}
                </text>
              </g>
            ))}
            {bars.map((b, i) => {
              const cx = PAD.left + band * i + band / 2
              const h = Math.max(0, y(0) - y(b.value))
              const x = cx - barW / 2
              const r = Math.min(4, barW / 2, h)
              return (
                <g
                  key={b.label}
                  tabIndex={0}
                  role="button"
                  aria-label={`${b.label}: ${b.display}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="outline-none"
                >
                  {/* Hit target: the whole band, taller than the bar */}
                  <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent" />
                  {h > 0 && (
                    // Rounded data end, square at the baseline
                    <path
                      d={`M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + barW - r} Q${x + barW},${y(0) - h} ${x + barW},${y(0) - h + r} V${y(0)} Z`}
                      fill={SERIES}
                      opacity={active === null || active === i ? 1 : 0.45}
                    />
                  )}
                  {i % labelEvery === 0 && (
                    <text x={cx} y={HEIGHT - 6} textAnchor="middle" fontSize={10} fill="#8a877f">
                      {b.label}
                    </text>
                  )}
                </g>
              )
            })}
            <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke="#c9c5bb" strokeWidth={1} />
          </svg>
          {active !== null && bars[active] && (
            <div
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-full bg-ink text-paper text-xs px-2 py-1 whitespace-nowrap"
              style={{
                left: `${((PAD.left + band * active + band / 2) / width) * 100}%`,
                top: `${(y(bars[active].value) / HEIGHT) * 100}%`,
              }}
              role="status"
            >
              <span className="text-paper/70">{bars[active].label}</span> · {bars[active].display}
            </div>
          )}
        </div>
      )}
    </figure>
  )
}
