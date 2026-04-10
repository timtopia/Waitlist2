"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { Input, Textarea } from "@/components/ui/Input"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { useToast } from "@/components/ui/Toast"
import { ConfirmModal } from "@/components/ui/ConfirmModal"

interface LineData {
  id: string
  name: string
  description: string | null
  isPublic: boolean
  isActive: boolean
  opensAt: string | null
  closesAt: string | null
  maxCapacity: number | null
  ownerFeePercent: number
  currentCount: number
}

function toLocalDatetime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const offset = d.getTimezoneOffset()
  const local = new Date(d.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

export function EditLineClient({ line }: { line: LineData }) {
  const router = useRouter()
  const { addToast } = useToast()

  const [name, setName] = useState(line.name)
  const [description, setDescription] = useState(line.description || "")
  const [isPublic, setIsPublic] = useState(line.isPublic)
  const [isActive, setIsActive] = useState(line.isActive)
  const [enableSchedule, setEnableSchedule] = useState(!!(line.opensAt || line.closesAt))
  const [opensAt, setOpensAt] = useState(toLocalDatetime(line.opensAt))
  const [closesAt, setClosesAt] = useState(toLocalDatetime(line.closesAt))
  const [maxCapacity, setMaxCapacity] = useState(line.maxCapacity?.toString() || "")
  const [ownerFeePercent, setOwnerFeePercent] = useState(line.ownerFeePercent?.toString() || "0")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Delete confirmation
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError("Name is required")
      return
    }

    if (maxCapacity && parseInt(maxCapacity) < line.currentCount) {
      setError(`Capacity cannot be less than current participants (${line.currentCount})`)
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/lines/${line.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          isPublic,
          isActive,
          opensAt: enableSchedule && opensAt ? new Date(opensAt).toISOString() : null,
          closesAt: enableSchedule && closesAt ? new Date(closesAt).toISOString() : null,
          maxCapacity: maxCapacity ? parseInt(maxCapacity, 10) : null,
          ownerFeePercent: ownerFeePercent ? parseFloat(ownerFeePercent) : 0,
        }),
      })

      if (res.ok) {
        addToast("Line updated successfully!", "success")
        router.push(`/lines/${line.id}`)
        router.refresh()
      } else {
        const data = await res.json()
        setError(data.error || "Failed to update line")
        addToast(data.error || "Failed to update line", "error")
      }
    } catch {
      setError("Failed to update line")
      addToast("Failed to update line", "error")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/lines/${line.id}`, { method: "DELETE" })
      if (res.ok) {
        addToast("Line deleted", "success")
        router.push("/dashboard")
      } else {
        const data = await res.json()
        addToast(data.error || "Failed to delete line", "error")
      }
    } finally {
      setDeleting(false)
      setShowDelete(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <ConfirmModal
        open={showDelete}
        title="Delete Line"
        message={`Are you sure you want to delete "${line.name}"? This will remove all positions and transaction history. This action cannot be undone.`}
        confirmLabel="Delete Line"
        variant="danger"
        isLoading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Edit Line</h1>
              <p className="text-sm text-gray-500 mt-1">
                {line.currentCount} {line.currentCount === 1 ? "person" : "people"} currently in line
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowDelete(true)}
            >
              Delete Line
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
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

            {/* Public Toggle */}
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
                <label className="text-sm font-medium text-gray-700">Public Line</label>
                <p className="text-xs text-gray-500">
                  {isPublic ? "Anyone can find this line in Browse" : "Only people with the link can join"}
                </p>
              </div>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  isActive ? "bg-green-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isActive ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <div>
                <label className="text-sm font-medium text-gray-700">Active</label>
                <p className="text-xs text-gray-500">
                  {isActive ? "Line is accepting joins" : "Line is paused - no new joins allowed"}
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
                min={line.currentCount || 1}
                placeholder="Unlimited"
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                {line.currentCount > 0
                  ? `Must be at least ${line.currentCount} (current participants)`
                  : "Leave empty for unlimited spots"}
              </p>
            </div>

            {/* Owner Fee */}
            <div>
              <label htmlFor="ownerFee" className="block text-sm font-medium text-gray-700 mb-1">
                Your Fee on Position Sales (%)
              </label>
              <input
                id="ownerFee"
                type="number"
                min="0"
                max="50"
                step="0.5"
                placeholder="0"
                value={ownerFeePercent}
                onChange={(e) => setOwnerFeePercent(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                Percentage you earn when someone buys a position.
                {ownerFeePercent && parseFloat(ownerFeePercent) > 0 ? (
                  <span className="text-blue-600 ml-1">
                    e.g. on a $10 sale, you earn ${(10 * parseFloat(ownerFeePercent) / 100).toFixed(2)}
                  </span>
                ) : (
                  <span> A 10% platform fee also applies to each sale.</span>
                )}
              </p>
              {parseFloat(ownerFeePercent) !== line.ownerFeePercent && (
                <p className="text-xs text-amber-600 mt-1">
                  Changing the fee will update all displayed prices immediately. Purchases already in progress will keep their original fees.
                </p>
              )}
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
                <label className="text-sm font-medium text-gray-700">Schedule Open/Close Times</label>
                <p className="text-xs text-gray-500">
                  {enableSchedule
                    ? "Line will only accept joins during the scheduled window"
                    : "No scheduled open/close times"}
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
                  <p className="text-xs text-gray-500 mt-1">Leave empty to open immediately</p>
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
                  <p className="text-xs text-gray-500 mt-1">Leave empty for no end time</p>
                </div>
              </div>
            )}

            {error && name.trim() && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
              <Button type="submit" isLoading={saving}>
                Save Changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
