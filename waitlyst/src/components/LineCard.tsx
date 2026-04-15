"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Card, CardContent } from "./ui/Card"
import { getStatusBadge } from "@/lib/line-status"
import { formatDropCountdown, formatCurrency } from "@/lib/format"

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
    lowestAskingPrice?: number | null
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

export function LineCard({ line }: LineCardProps) {
  const status = getStatusBadge(line)
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
    <Link href={`/lines/${line.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            {/* Product thumbnail */}
            {line.productImage && (
              <div className="flex-shrink-0">
                <Image
                  src={line.productImage}
                  alt={line.productName || line.name}
                  width={48}
                  height={48}
                  className="rounded-lg object-cover w-12 h-12"
                />
              </div>
            )}

            {/* Main content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between mb-1">
                <h3 className="text-lg font-semibold text-gray-900 truncate">{line.name}</h3>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  {showDropBadge && msUntilOpen !== null && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 tabular-nums whitespace-nowrap">
                      Dropping in {formatDropCountdown(msUntilOpen)}
                    </span>
                  )}
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.className}`}>
                    {status.label}
                  </span>
                </div>
              </div>

              {/* Product subtitle */}
              {line.productName && (
                <p className="text-xs text-gray-500 mb-1">{line.productName}</p>
              )}

              {/* Product price tag */}
              {line.productPrice != null && (
                <span className="inline-block text-xs font-medium bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded mb-2">
                  Retail: ${line.productPrice.toFixed(2)}
                </span>
              )}

              {/* Trading badge */}
              {line.lowestAskingPrice != null && (
                <span className="inline-block text-xs font-medium bg-green-100 text-green-700 px-1.5 py-0.5 rounded mb-2 ml-1">
                  From {formatCurrency(line.lowestAskingPrice)}
                </span>
              )}

              {line.description && (
                <p className="text-gray-600 text-sm mb-4 line-clamp-2">{line.description}</p>
              )}
              {line.maxCapacity && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>{line._count.positions}/{line.maxCapacity} spots</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${
                        line._count.positions >= line.maxCapacity ? "bg-red-500" : "bg-blue-500"
                      }`}
                      style={{ width: `${Math.min((line._count.positions / line.maxCapacity) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center space-x-2">
                  {line.createdBy.image ? (
                    <Image
                      src={line.createdBy.image}
                      alt={line.createdBy.name || "Creator"}
                      width={24}
                      height={24}
                      className="rounded-full"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-xs">
                      {line.createdBy.name?.[0] || "?"}
                    </div>
                  )}
                  <span className="text-gray-500">{line.createdBy.name || "Anonymous"}</span>
                </div>
                <div className="flex items-center space-x-1 text-gray-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <span>{line._count.positions} in line</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
