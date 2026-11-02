"use client"

import { useEffect, useRef, useState } from "react"

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function AnimatedStat({ value, label }: { value: number; label: string }) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (value === 0 || hasAnimated.current) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true
          const duration = 1500
          const start = performance.now()

          function tick(now: number) {
            const elapsed = now - start
            const progress = Math.min(elapsed / duration, 1)
            const eased = easeOutCubic(progress)
            setDisplay(Math.round(eased * value))
            if (progress < 1) {
              requestAnimationFrame(tick)
            }
          }

          requestAnimationFrame(tick)
          observer.disconnect()
        }
      },
      { threshold: 0.3 }
    )

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => observer.disconnect()
  }, [value])

  return (
    <div ref={ref} className="py-8 sm:py-10 sm:px-8 first:sm:pl-0">
      <div className="font-mono text-4xl sm:text-5xl tabular-nums tracking-tight">
        {display.toLocaleString()}
      </div>
      <div className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60 mt-2">{label}</div>
    </div>
  )
}
