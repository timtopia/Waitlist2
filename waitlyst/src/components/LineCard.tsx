import Link from "next/link"
import Image from "next/image"
import { Card, CardContent } from "./ui/Card"

interface LineCardProps {
  line: {
    id: string
    name: string
    description: string | null
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
  return (
    <Link href={`/lines/${line.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">{line.name}</h3>
          {line.description && (
            <p className="text-gray-600 text-sm mb-4 line-clamp-2">{line.description}</p>
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
