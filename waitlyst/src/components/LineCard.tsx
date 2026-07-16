"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { getLineStatus, getStatusBadge } from "@/lib/line-status"
import { formatDropCountdown } from "@/lib/format"

interface LineCardProps {
  line: {
    id: string
    name: string
    description: string | null
    opensAt?: string | null
    closesAt?: string | null
    maxCapacity?: number | null
    productName?: string | null
    productImage?: string | null
    productPrice?: number | null
    productUrl?: string | null
    createdBy: {
      name: string | null
      image: string | null
    }
    _count: {
      positions: number
    }
    createdAt: string
  }
}

const statusDot: Record<string, string> = {
  open: "bg-green-600",
  upcoming: "bg-amber-500",
  closed: "bg-ink/30",
  full: "bg-accent",
}

export function LineCard({ line }: LineCardProps) {
  const status = getStatusBadge(line)
  const statusKey = getLineStatus(line)
  const [now, setNow] = useState(() => new Date())

  // Determine if we need a live countdown (opensAt in future and < 24h away)
  const opensAtDate = line.opensAt ? new Date(line.opensAt) : null
  const msUntilOpen = opensAtDate ? opensAtDate.getTime() - now.getTime() : null
  const showDropBadge = msUntilOpen !== null && msUntilOpen > 0 && msUntilOpen < 24 * 60 * 60 * 1000

  useEffect(() => {
    if (!showDropBadge) return
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [showDropBadge])

  return (
    <Link href={`/lines/${line.id}`} className="block group">
      <div className="grid grid-cols-[auto_1fr_auto] sm:grid-cols-[7rem_1fr_auto] items-center gap-4 sm:gap-6 px-4 sm:px-6 py-5 bg-white hover:bg-paper transition-colors">
        {/* Count */}
        <div className="text-left">
          <div className="font-mono text-2xl sm:text-3xl tabular-nums leading-none">
            {line._count.positions}
            {line.maxCapacity ? (
              <span className="text-ink/40 text-base sm:text-lg">/{line.maxCapacity}</span>
            ) : null}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40 mt-1.5">
            In line
          </div>
        </div>

        {/* Name + meta */}
        <div className="min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            {line.productImage && (
              <Image
                src={line.productImage}
                alt={line.productName || line.name}
                width={40}
                height={40}
                className="object-cover w-10 h-10 border border-rule flex-shrink-0"
              />
            )}
            <div className="min-w-0">
              <h3 className="font-semibold tracking-tight truncate group-hover:underline underline-offset-4">
                {line.name}
              </h3>
              <p className="text-sm text-ink/50 truncate">
                {line.productName ||
                  line.description ||
                  `Started by ${line.createdBy.name || "Anonymous"}`}
                {line.productPrice != null && (
                  <span className="font-mono text-xs ml-2">
                    Retail ${line.productPrice.toFixed(2)}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="text-right">
          {showDropBadge && msUntilOpen !== null ? (
            <span className="font-mono text-xs uppercase tracking-widest text-accent tabular-nums whitespace-nowrap">
              Opens in {formatDropCountdown(msUntilOpen)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-ink/60 whitespace-nowrap">
              <span className={`w-1.5 h-1.5 ${statusDot[statusKey]}`} aria-hidden />
              {status.label}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
