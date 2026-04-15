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
  const [ownerFeePercent, setOwnerFeePercent] = useState("")
  const [showProductDetails, setShowProductDetails] = useState(false)
  const [productName, setProductName] = useState("")
  const [productImage, setProductImage] = useState("")
  const [productPrice, setProductPrice] = useState("")
  const [productUrl, setProductUrl] = useState("")
  const [hideCapacity, setHideCapacity] = useState(false)
  const [showResaleControls, setShowResaleControls] = useState(false)
  const [allowResale, setAllowResale] = useState(true)
  const [maxAskingPrice, setMaxAskingPrice] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<string>("custom")

  const templates = [
    {
      id: "product-drop",
      icon: "\uD83C\uDFAF",
      name: "Product Drop",
      desc: "Limited release drop",
      apply: () => {
        setMaxCapacity("100")
        setOwnerFeePercent("10")
        setAllowResale(true)
        setHideCapacity(true)
        setDescription("Limited release drop")
        setShowResaleControls(true)
      },
    },
    {
      id: "live-queue",
      icon: "\uD83C\uDFAB",
      name: "Live Queue",
      desc: "First come, first served",
      apply: () => {
        setMaxCapacity("")
        setOwnerFeePercent("0")
        setAllowResale(false)
        setHideCapacity(false)
        setDescription("Live queue - first come, first served")
        setShowResaleControls(true)
      },
    },
    {
      id: "event-waitlist",
      icon: "\uD83D\uDCCB",
      name: "Event Waitlist",
      desc: "Waitlist with position swapping",
      apply: () => {
        setMaxCapacity("500")
        setOwnerFeePercent("5")
        setAllowResale(true)
        setHideCapacity(false)
        setDescription("Event waitlist with position swapping")
        setShowResaleControls(true)
      },
    },
    {
      id: "custom",
      icon: "\u2699\uFE0F",
      name: "Custom",
      desc: "Start from scratch",
      apply: () => {
        // Don't fill anything — leave form as-is
      },
    },
  ]

  function applyTemplate(id: string) {
    setSelectedTemplate(id)
    const tpl = templates.find((t) => t.id === id)
    tpl?.apply()
  }

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
          ownerFeePercent: ownerFeePercent ? parseFloat(ownerFeePercent) : 0,
          productName: productName.trim() || null,
          productImage: productImage.trim() || null,
          productPrice: productPrice ? parseFloat(productPrice) : null,
          productUrl: productUrl.trim() || null,
          allowResale,
          maxAskingPrice: maxAskingPrice ? parseFloat(maxAskingPrice) : null,
          hideCapacity: maxCapacity ? hideCapacity : false,
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
            {/* Quick-start templates */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quick Start
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl.id)}
                    className={`flex flex-col items-center text-center rounded-lg border-2 p-3 transition-all hover:shadow-sm ${
                      selectedTemplate === tpl.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <span className="text-2xl leading-none mb-1">{tpl.icon}</span>
                    <span className="text-sm font-medium text-gray-900">{tpl.name}</span>
                    <span className="text-xs text-gray-500 mt-0.5 leading-tight">{tpl.desc}</span>
                  </button>
                ))}
              </div>
            </div>

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
              {maxCapacity && (
                <label className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    checked={hideCapacity}
                    onChange={(e) => setHideCapacity(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Hide capacity from members</span>
                </label>
              )}
              {maxCapacity && hideCapacity && (
                <p className="text-xs text-gray-500 mt-1">
                  Members will see &quot;Limited spots available&quot; instead of the exact number
                </p>
              )}
            </div>

            {/* Owner Fee */}
            <div>
              <label htmlFor="ownerFee" className="block text-sm font-medium text-gray-700 mb-1">
                Your Fee on Position Swaps (%)
              </label>
              <div className="relative">
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
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Percentage you earn when someone swaps a position in your line.
                {ownerFeePercent && parseFloat(ownerFeePercent) > 0 ? (
                  <span className="text-blue-600 ml-1">
                    e.g. on a $10 swap, you earn ${(10 * parseFloat(ownerFeePercent) / 100).toFixed(2)}
                  </span>
                ) : (
                  <span> A 10% platform fee also applies to each swap.</span>
                )}
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

            {/* Product Details (collapsible) */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowProductDetails(!showProductDetails)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <span>Product Details (optional)</span>
                <svg
                  className={`h-4 w-4 text-gray-400 transition-transform ${showProductDetails ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showProductDetails && (
                <div className="px-4 pb-4 space-y-4 border-t border-gray-200 pt-4">
                  <div>
                    <label htmlFor="productName" className="block text-sm font-medium text-gray-700 mb-1">
                      Product Name
                    </label>
                    <input
                      id="productName"
                      type="text"
                      placeholder='e.g., Nike Dunk Low Travis Scott'
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label htmlFor="productImage" className="block text-sm font-medium text-gray-700 mb-1">
                      Product Image URL
                    </label>
                    <input
                      id="productImage"
                      type="url"
                      placeholder="https://example.com/image.jpg"
                      value={productImage}
                      onChange={(e) => setProductImage(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label htmlFor="productPrice" className="block text-sm font-medium text-gray-700 mb-1">
                      Retail Price ($)
                    </label>
                    <input
                      id="productPrice"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={productPrice}
                      onChange={(e) => setProductPrice(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label htmlFor="productUrl" className="block text-sm font-medium text-gray-700 mb-1">
                      Product Link
                    </label>
                    <input
                      id="productUrl"
                      type="url"
                      placeholder="https://example.com/product"
                      value={productUrl}
                      onChange={(e) => setProductUrl(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Swap Settings (collapsible) */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowResaleControls(!showResaleControls)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <span>Swap Settings (optional)</span>
                <svg
                  className={`h-4 w-4 text-gray-400 transition-transform ${showResaleControls ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showResaleControls && (
                <div className="px-4 pb-4 space-y-4 border-t border-gray-200 pt-4">
                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={() => setAllowResale(!allowResale)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        allowResale ? "bg-blue-600" : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          allowResale ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                    <div>
                      <label className="text-sm font-medium text-gray-700">
                        Allow position swapping
                      </label>
                      <p className="text-xs text-gray-500">
                        {allowResale
                          ? "People can swap their positions with the person next to them"
                          : "Swapping is disabled — no one can swap positions"}
                      </p>
                    </div>
                  </div>
                  {allowResale && (
                    <div>
                      <label htmlFor="maxAskingPrice" className="block text-sm font-medium text-gray-700 mb-1">
                        Max Asking Price (optional)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                        <input
                          id="maxAskingPrice"
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="No limit"
                          value={maxAskingPrice}
                          onChange={(e) => setMaxAskingPrice(e.target.value)}
                          className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Cap the maximum swap price anyone can set for their position. Leave empty for no limit.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

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
