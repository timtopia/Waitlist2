"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { LineCard } from "@/components/LineCard"
import { Button } from "@/components/ui/Button"
import { getLineStatus } from "@/lib/line-status"

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
  lowestAskingPrice: number | null
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Browse Lines</h1>
        <Link href="/lines/new">
          <Button>Create a Line</Button>
        </Link>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search lines..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "open", "upcoming", "closed"] as FilterStatus[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2 mb-8">
        <span className="text-sm text-gray-500">Sort by:</span>
        {(Object.keys(sortLabels) as SortOption[]).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              sortBy === s
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {sortLabels[s]}
          </button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-48 bg-gray-200 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          {lines.length === 0 ? (
            <>
              <p className="text-gray-500 mb-2">No active lines yet.</p>
              <p className="text-sm text-gray-400">Be the first to create one!</p>
            </>
          ) : (
            <>
              <p className="text-gray-500 mb-2">No lines match your search.</p>
              <button
                onClick={() => { setSearch(""); setFilter("all"); setSortBy("newest") }}
                className="text-sm text-blue-600 hover:underline"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-4">
            {filtered.length} {filtered.length === 1 ? "line" : "lines"} found
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((line) => (
              <LineCard key={line.id} line={line} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
