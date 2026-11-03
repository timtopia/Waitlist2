"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { LineCard } from "@/components/LineCard"
import { Button } from "@/components/ui/Button"
import { buttonClasses } from "@/components/ui/buttonStyles"
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

const FILTERS: FilterStatus[] = ["all", "open", "upcoming", "closed"]
const SORTS: SortOption[] = ["newest", "popular", "ending-soon"]

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

  // Search, filter and sort live in the URL, so Back from a line returns to
  // the same view instead of resetting it
  const urlRead = useRef(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const q = params.get("q")
    const status = params.get("status") as FilterStatus | null
    const sort = params.get("sort") as SortOption | null
    if (q) setSearch(q)
    if (status && FILTERS.includes(status)) setFilter(status)
    if (sort && SORTS.includes(sort)) setSortBy(sort)
    urlRead.current = true
  }, [])
  useEffect(() => {
    if (!urlRead.current) return
    const params = new URLSearchParams()
    if (search) params.set("q", search)
    if (filter !== "all") params.set("status", filter)
    if (sortBy !== "newest") params.set("sort", sortBy)
    const query = params.toString()
    window.history.replaceState(window.history.state, "", query ? `?${query}` : window.location.pathname)
  }, [search, filter, sortBy])

  // A failed load used to look like an empty board
  const [loadError, setLoadError] = useState(false)
  const fetchLines = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch("/api/lines")
      if (res.ok) {
        setLines(await res.json())
      } else {
        setLoadError(true)
      }
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLines()
  }, [fetchLines])

  const filtered = useMemo(() => {
    const result = lines.filter((line) => {
      // Search
      if (search) {
        const q = search.toLowerCase()
        const matchesName = line.name.toLowerCase().includes(q)
        const matchesDesc = line.description?.toLowerCase().includes(q)
        // Cards show the product, so people search for it
        const matchesProduct = line.productName?.toLowerCase().includes(q)
        if (!matchesName && !matchesDesc && !matchesProduct) return false
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

    // Sort. Lines you can still join come first whatever the sort, so a
    // first-timer doesn't tap a closed one at the top and hit a dead end.
    const joinable = (line: Line) => {
      const status = getLineStatus(line)
      return status === "open" || status === "upcoming" ? 0 : 1
    }
    return result.sort((a, b) => {
      const rank = joinable(a) - joinable(b)
      if (rank !== 0) return rank
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
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-ink/60 mb-3">
            The board
          </p>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">Open lines</h1>
          <p className="mt-3 text-sm text-ink/60 max-w-xl">
            Public lines anyone can join. Looking for a specific restaurant or
            shop? Open the link or scan the QR code they shared; private lines
            aren&apos;t listed here.
          </p>
        </div>
        <Link href="/lines/new" className={buttonClasses()}>Start a line</Link>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search lines…"
            aria-label="Search lines"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-0 py-2 bg-transparent border-0 border-b border-rule text-base focus:outline-none focus:border-ink placeholder:text-ink/60"
          />
        </div>
        <div className="flex gap-5">
          {(["all", "open", "upcoming", "closed"] as FilterStatus[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`min-h-11 pointer-fine:min-h-0 font-mono text-xs uppercase tracking-widest pb-1 border-b-2 transition-colors ${
                filter === f
                  ? "border-accent text-ink"
                  : "border-transparent text-ink/60 hover:text-ink"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Sort */}
      <div className="flex items-center gap-5 mb-8">
        <span className="font-mono text-xs uppercase tracking-widest text-ink/60">Sort</span>
        {(Object.keys(sortLabels) as SortOption[]).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            aria-pressed={sortBy === s}
            className={`min-h-11 pointer-fine:min-h-0 font-mono text-xs uppercase tracking-widest pb-1 border-b-2 transition-colors ${
              sortBy === s
                ? "border-accent text-ink"
                : "border-transparent text-ink/60 hover:text-ink"
            }`}
          >
            {sortLabels[s]}
          </button>
        ))}
      </div>

      {/* Always mounted, so a search or filter change is spoken */}
      <p className="sr-only" aria-live="polite">
        {loading || loadError ? "" : filtered.length === 0 ? (lines.length === 0 ? "No lines" : "No lines match") : `${filtered.length} ${filtered.length === 1 ? "line" : "lines"}`}
      </p>
      {/* Results */}
      {loading ? (
        <div className="border border-rule divide-y divide-rule" role="status">
          <span className="sr-only">Loading lines...</span>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-white animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <div className="text-center py-20 border border-rule bg-white" role="alert">
          <p className="text-ink/60 mb-4">Couldn&apos;t load lines. Check your connection and try again.</p>
          <Button variant="secondary" onClick={fetchLines}>Try again</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 border border-rule bg-white">
          {lines.length === 0 ? (
            <>
              <p className="text-ink/60 mb-2">No public lines are open right now.</p>
              <p className="text-sm text-ink/60 mb-6">
                Joining a particular place? Use the link or QR code they gave you.
                Running one? Start your own.
              </p>
              <Link href="/lines/new" className={buttonClasses()}>Start a line</Link>
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
          <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">
            {filtered.length} {filtered.length === 1 ? "line" : "lines"}
          </p>
          <h2 className="sr-only">Lines</h2>
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
