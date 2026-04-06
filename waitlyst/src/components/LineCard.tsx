import Link from "next/link"
import Image from "next/image"
import { Card, CardContent } from "./ui/Card"

interface LineCardProps {
  line: {
    id: string
    name: string
    description: string | null
    opensAt?: string | null
    closesAt?: string | null
    maxCapacity?: number | null
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

function getStatusBadge(line: LineCardProps["line"]) {
  const now = new Date()
  if (line.opensAt && now < new Date(line.opensAt)) {
    return { label: "Upcoming", className: "bg-amber-100 text-amber-700" }
  }
  if (line.closesAt && now > new Date(line.closesAt)) {
    return { label: "Closed", className: "bg-red-100 text-red-700" }
  }
  if (line.maxCapacity && line._count.positions >= line.maxCapacity) {
    return { label: "Full", className: "bg-red-100 text-red-700" }
  }
  return { label: "Open", className: "bg-green-100 text-green-700" }
}

export function LineCard({ line }: LineCardProps) {
  const status = getStatusBadge(line)

  return (
    <Link href={`/lines/${line.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-2">
            <h3 className="text-lg font-semibold text-gray-900">{line.name}</h3>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ml-2 ${status.className}`}>
              {status.label}
            </span>
          </div>
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
        </CardContent>
      </Card>
    </Link>
  )
}
