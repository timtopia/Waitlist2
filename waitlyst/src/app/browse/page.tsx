"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { LineCard } from "@/components/LineCard"
import { Button } from "@/components/ui/Button"
import { getLineStatus } from "@/lib/line-status"

// Note: metadata for this page is exported from ./layout.tsx since this is a client component

interface Line {
  id: string
  name: string
  description: string | null
  opensAt: string | null
  closesAt: string | null
  maxCapacity: number | null
  productName: string | null
  productImage: string | null
  productPrice: number | null
  productUrl: string | null
  createdBy: { name: string | null; image: string | null }
  _count: { positions: number }
  createdAt: string
}

type FilterStatus = "all" | "open" | "upcoming" | "closed"
type SortOption = "newest" | "popular" | "ending-soon"

const sortLabels: Record<SortOption, string> = {
  newest: "Newest",
  popular: "Most Popular",
  "ending-soon": "Ending Soon",
}

export default function BrowsePage() {
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<FilterStatus>("all")
  const [sortBy, setSortBy] = useState<SortOption>("newest")

  useEffect(() => {
    async function fetchLines() {
      try {
        const res = await fetch("/api/lines")
        if (res.ok) {
          setLines(await res.json())
        }
      } finally {
        setLoading(false)
      }
    }
    fetchLines()
  }, [])

  const filtered = useMemo(() => {
    const result = lines.filter((line) => {
      // Search
      if (search) {
        const q = search.toLowerCase()
        const matchesName = line.name.toLowerCase().includes(q)
        const matchesDesc = line.description?.toLowerCase().includes(q)
        if (!matchesName && !matchesDesc) return false
      }

      // Status filter
      if (filter !== "all") {
        const status = getLineStatus(line)
        if (filter === "open" && status !== "open") return false
        if (filter === "upcoming" && status !== "upcoming") return false
        if (filter === "closed" && status !== "closed" && status !== "full") return false
      }

      return true
    })

    // Sort
    return result.sort((a, b) => {
      switch (sortBy) {
        case "newest":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case "popular":
          return b._count.positions - a._count.positions
        case "ending-soon": {
          const now = new Date()
          const aClose = a.closesAt ? new Date(a.closesAt) : null
          const bClose = b.closesAt ? new Date(b.closesAt) : null
          const aOpen = aClose && aClose > now
          const bOpen = bClose && bClose > now
          // Lines with a future closesAt come first, sorted soonest first
          if (aOpen && bOpen) return aClose!.getTime() - bClose!.getTime()
          if (aOpen) return -1
          if (bOpen) return 1
          // Remaining lines fall back to newest
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        }
        default:
          return 0
      }
    })
  }, [lines, search, filter, sortBy])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10 border-b border-ink pb-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-ink/50 mb-3">
            The board
          </p>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">Open lines</h1>
        </div>
        <Link href="/lines/new">
          <Button>Start a line</Button>
        </Link>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search lines…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-0 py-2 bg-transparent border-0 border-b border-rule text-base focus:outline-none focus:border-ink placeholder:text-ink/30"
          />
        </div>
        <div className="flex gap-5">
          {(["all", "open", "upcoming", "closed"] as FilterStatus[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`font-mono text-xs uppercase tracking-widest pb-1 border-b-2 transition-colors ${
                filter === f
                  ? "border-accent text-ink"
                  : "border-transparent text-ink/40 hover:text-ink"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Sort */}
      <div className="flex items-center gap-5 mb-8">
        <span className="font-mono text-xs uppercase tracking-widest text-ink/40">Sort</span>
        {(Object.keys(sortLabels) as SortOption[]).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`font-mono text-xs uppercase tracking-widest pb-1 border-b-2 transition-colors ${
              sortBy === s
                ? "border-accent text-ink"
                : "border-transparent text-ink/40 hover:text-ink"
            }`}
          >
            {sortLabels[s]}
          </button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div className="border border-rule divide-y divide-rule">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-white animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 border border-rule bg-white">
          {lines.length === 0 ? (
            <>
              <p className="text-ink/60 mb-2">No lines on the board yet.</p>
              <p className="text-sm text-ink/40 mb-6">Be the first to start one.</p>
              <Link href="/lines/new">
                <Button>Start a line</Button>
              </Link>
            </>
          ) : (
            <>
              <p className="text-ink/60 mb-2">Nothing matches your search.</p>
              <button
                onClick={() => { setSearch(""); setFilter("all"); setSortBy("newest") }}
                className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="font-mono text-xs uppercase tracking-widest text-ink/40 mb-3">
            {filtered.length} {filtered.length === 1 ? "line" : "lines"}
          </p>
          <div className="border border-rule divide-y divide-rule">
            {filtered.map((line) => (
              <LineCard key={line.id} line={line} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
