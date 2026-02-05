"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession, signIn } from "next-auth/react"
import { useParams } from "next/navigation"
import Image from "next/image"
import { Button } from "@/components/ui/Button"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { QueueDisplay } from "@/components/QueueDisplay"
import { useLineUpdates } from "@/hooks/useLineUpdates"

interface Line {
  id: string
  name: string
  description: string | null
  isActive: boolean
  createdAt: string
  createdBy: {
    id: string
    name: string | null
    image: string | null
  }
  positions: {
    id: string
    position: number
    askingPrice: string | null
    lockedUntil: string | null
    user: {
      id: string
      name: string | null
      image: string | null
    }
  }[]
}

export default function LineDetailPage() {
  const params = useParams()
  const lineId = params.lineId as string
  const { data: session, status } = useSession()
  const [line, setLine] = useState<Line | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchLine = useCallback(async () => {
    try {
      const res = await fetch(`/api/lines/${lineId}`)
      if (res.ok) {
        const data = await res.json()
        setLine(data)
      } else {
        setError("Line not found")
      }
    } catch {
      setError("Failed to load line")
    } finally {
      setLoading(false)
    }
  }, [lineId])

  useEffect(() => {
    fetchLine()
  }, [fetchLine])

  // Subscribe to real-time updates
  useLineUpdates(lineId, useCallback(() => {
    fetchLine()
  }, [fetchLine]))

  const isInLine = line?.positions.some((p) => p.user.id === session?.user?.id)
  const isCreator = line?.createdBy.id === session?.user?.id

  async function handleJoin() {
    if (!session) {
      signIn("google")
      return
    }

    setJoining(true)
    try {
      const res = await fetch(`/api/lines/${lineId}/join`, {
        method: "POST",
      })
      if (res.ok) {
        fetchLine()
      } else {
        const data = await res.json()
        alert(data.error || "Failed to join line")
      }
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3 mb-8"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error || !line) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500">{error || "Line not found"}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{line.name}</h1>
              {line.description && (
                <p className="text-gray-600">{line.description}</p>
              )}
            </div>
            {!isInLine && !isCreator && (
              <Button onClick={handleJoin} isLoading={joining}>
                {session ? "Join Line" : "Sign in to Join"}
              </Button>
            )}
            {isCreator && (
              <span className="text-sm text-blue-600 font-medium bg-blue-50 px-3 py-1 rounded-full">
                Your Line
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2 text-sm text-gray-500">
            <span>Created by</span>
            {line.createdBy.image ? (
              <Image
                src={line.createdBy.image}
                alt={line.createdBy.name || "Creator"}
                width={20}
                height={20}
                className="rounded-full"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center text-xs">
                {line.createdBy.name?.[0] || "?"}
              </div>
            )}
            <span className="font-medium text-gray-700">
              {line.createdBy.name || "Anonymous"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-gray-900">
            Queue ({line.positions.length} {line.positions.length === 1 ? "person" : "people"})
          </h2>
        </CardHeader>
        <CardContent>
          <QueueDisplay
            lineId={line.id}
            positions={line.positions}
            onRefresh={fetchLine}
            isCreator={isCreator}
          />
        </CardContent>
      </Card>
    </div>
  )
}
