"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/Button"
import { Input, Textarea } from "@/components/ui/Input"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"

export default function CreateLinePage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isPublic, setIsPublic] = useState(true)
  const [enableSchedule, setEnableSchedule] = useState(false)
  const [opensAt, setOpensAt] = useState("")
  const [closesAt, setClosesAt] = useState("")
  const [maxCapacity, setMaxCapacity] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status === "loading") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-8"></div>
          <div className="space-y-4">
            <div className="h-10 bg-gray-200 rounded"></div>
            <div className="h-24 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500 mb-4">You must be signed in to create a line.</p>
            <Button onClick={() => router.push("/")}>Go Home</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError("Name is required")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          isPublic,
          opensAt: enableSchedule && opensAt ? new Date(opensAt).toISOString() : null,
          closesAt: enableSchedule && closesAt ? new Date(closesAt).toISOString() : null,
          maxCapacity: maxCapacity ? parseInt(maxCapacity, 10) : null,
        }),
      })

      if (res.ok) {
        const line = await res.json()
        router.push(`/lines/${line.id}`)
      } else {
        const data = await res.json()
        setError(data.error || "Failed to create line")
      }
    } catch {
      setError("Failed to create line")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-bold text-gray-900">Create a New Line</h1>
          <p className="text-gray-600 mt-1">
            Create a virtual queue for others to join
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              id="name"
              label="Line Name"
              placeholder="e.g., Coffee Shop Queue"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={error && !name.trim() ? "Name is required" : undefined}
            />

            <Textarea
              id="description"
              label="Description (optional)"
              placeholder="What is this line for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />

            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => setIsPublic(!isPublic)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  isPublic ? "bg-blue-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isPublic ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Public Line
                </label>
                <p className="text-xs text-gray-500">
                  {isPublic
                    ? "Anyone can find this line in Browse"
                    : "Only people with the link can join"}
                </p>
              </div>
            </div>

            {/* Capacity */}
            <div>
              <label htmlFor="maxCapacity" className="block text-sm font-medium text-gray-700 mb-1">
                Max Capacity (optional)
              </label>
              <input
                id="maxCapacity"
                type="number"
                min="1"
                placeholder="Unlimited"
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                Leave empty for unlimited spots
              </p>
            </div>

            {/* Schedule Toggle */}
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => setEnableSchedule(!enableSchedule)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  enableSchedule ? "bg-blue-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    enableSchedule ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Schedule Open/Close Times
                </label>
                <p className="text-xs text-gray-500">
                  {enableSchedule
                    ? "Line will only accept joins during the scheduled window"
                    : "Line is open immediately with no end time"}
                </p>
              </div>
            </div>

            {enableSchedule && (
              <div className="space-y-4 pl-4 border-l-2 border-blue-200">
                <div>
                  <label htmlFor="opensAt" className="block text-sm font-medium text-gray-700 mb-1">
                    Opens At
                  </label>
                  <input
                    id="opensAt"
                    type="datetime-local"
                    value={opensAt}
                    onChange={(e) => setOpensAt(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Leave empty to open immediately
                  </p>
                </div>
                <div>
                  <label htmlFor="closesAt" className="block text-sm font-medium text-gray-700 mb-1">
                    Closes At
                  </label>
                  <input
                    id="closesAt"
                    type="datetime-local"
                    value={closesAt}
                    onChange={(e) => setClosesAt(e.target.value)}
                    min={opensAt || undefined}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Leave empty for no end time
                  </p>
                </div>
              </div>
            )}

            {error && name.trim() && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <div className="flex justify-end space-x-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
              <Button type="submit" isLoading={loading}>
                Create Line
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
