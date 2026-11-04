"use client"

import { useEffect, useRef, useState } from "react"

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
}

export function AnimatedStat({ value, label }: { value: number; label: string }) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    let frame = 0
    // Count up once; later changes (or zero, reduced motion, or no observer
    // support) just show the real number on the next frame.
    if (value === 0 || hasAnimated.current || prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      if (value !== 0) hasAnimated.current = true
      frame = requestAnimationFrame(() => setDisplay(value))
      return () => cancelAnimationFrame(frame)
    }

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
              frame = requestAnimationFrame(tick)
            }
          }

          frame = requestAnimationFrame(tick)
          observer.disconnect()
        }
      },
      { threshold: 0.3 }
    )

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [value])

  return (
    <div ref={ref} className="py-8 sm:py-10 sm:px-8 first:sm:pl-0">
      {/* Screen readers get the real figure, not "0" or a mid-count number */}
      <span className="sr-only">{`${value.toLocaleString()} ${label}`}</span>
      <div aria-hidden="true" className="font-mono text-4xl sm:text-5xl tabular-nums tracking-tight">
        {display.toLocaleString()}
      </div>
      <div aria-hidden="true" className="font-mono text-xs uppercase tracking-[0.2em] text-ink/70 mt-2">{label}</div>
    </div>
  )
}
