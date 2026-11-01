"use client"

import { useState } from "react"
import Link from "next/link"
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
  kind: "STANDARD" | "RESTAURANT"
  /** Capacity used as the server counts it: waiting guests on restaurant lines */
  capacityUsed: number
  productName: string | null
  productImage: string | null
  productPrice: number | null
  productUrl: string | null
  allowResale: boolean
  maxAskingPrice: number | null
  hideCapacity: boolean
  purchaseLimit: number | null
  responseWindowMinutes: number | null
}

function toLocalDatetime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const offset = d.getTimezoneOffset()
  const local = new Date(d.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

export function EditLineClient({
  line,
  platformFeePercent,
  needsPayoutSetup = false,
}: {
  line: LineData
  platformFeePercent: number
  /** Payments are on but the owner has no payout account connected yet */
  needsPayoutSetup?: boolean
}) {
  const router = useRouter()
  const { addToast } = useToast()
  const isRestaurant = line.kind === "RESTAURANT"

  const [name, setName] = useState(line.name)
  const [description, setDescription] = useState(line.description || "")
  const [isPublic, setIsPublic] = useState(line.isPublic)
  const [isActive, setIsActive] = useState(line.isActive)
  const [enableSchedule, setEnableSchedule] = useState(!!(line.opensAt || line.closesAt))
  const [opensAt, setOpensAt] = useState(toLocalDatetime(line.opensAt))
  const [closesAt, setClosesAt] = useState(toLocalDatetime(line.closesAt))
  const [maxCapacity, setMaxCapacity] = useState(line.maxCapacity?.toString() || "")
  const [ownerFeePercent, setOwnerFeePercent] = useState(line.ownerFeePercent?.toString() || "0")
  const [showProductDetails, setShowProductDetails] = useState(
    !!(line.productName || line.productImage || line.productPrice || line.productUrl)
  )
  const [hideCapacity, setHideCapacity] = useState(line.hideCapacity)
  const [showResaleControls, setShowResaleControls] = useState(
    !line.allowResale || line.maxAskingPrice != null
  )
  const [allowResale, setAllowResale] = useState(line.allowResale)
  const [maxAskingPrice, setMaxAskingPrice] = useState(line.maxAskingPrice?.toString() || "")
  const [purchaseLimit, setPurchaseLimit] = useState(line.purchaseLimit?.toString() || "")
  const [responseWindow, setResponseWindow] = useState(line.responseWindowMinutes?.toString() || "")
  const [productName, setProductName] = useState(line.productName || "")
  const [productImage, setProductImage] = useState(line.productImage || "")
  const [productPrice, setProductPrice] = useState(line.productPrice?.toString() || "")
  const [productUrl, setProductUrl] = useState(line.productUrl || "")
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

    if (maxCapacity && parseInt(maxCapacity) < line.capacityUsed) {
      setError(`Capacity cannot be less than the ${line.capacityUsed} ${isRestaurant ? "guests waiting" : "spots already taken"}`)
      return
    }

    const values: Record<string, unknown> = {
          name: name.trim(),
          description: description.trim() || null,
          isPublic,
          isActive,
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
          purchaseLimit: purchaseLimit && !isRestaurant ? parseInt(purchaseLimit, 10) : null,
          responseWindowMinutes: responseWindow ? parseInt(responseWindow, 10) : null,
          hideCapacity: maxCapacity ? hideCapacity : false,
    }
    // Send only what was changed on this page. Sending everything wrote back
    // the pause and public settings as they were when the page loaded, so
    // pausing from the console and then saving a new description here
    // quietly resumed the line.
    const original: Record<string, unknown> = {
      name: line.name,
      description: line.description,
      isPublic: line.isPublic,
      isActive: line.isActive,
      opensAt: line.opensAt ? new Date(line.opensAt).toISOString() : null,
      closesAt: line.closesAt ? new Date(line.closesAt).toISOString() : null,
      maxCapacity: line.maxCapacity,
      ownerFeePercent: line.ownerFeePercent,
      productName: line.productName,
      productImage: line.productImage,
      productPrice: line.productPrice,
      productUrl: line.productUrl,
      allowResale: line.allowResale,
      maxAskingPrice: line.maxAskingPrice,
      hideCapacity: line.hideCapacity,
      purchaseLimit: line.purchaseLimit,
      responseWindowMinutes: line.responseWindowMinutes,
    }
    const changes = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key]))
    )
    if (Object.keys(changes).length === 0) {
      router.push(`/lines/${line.id}`)
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/lines/${line.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
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
        message={`Delete "${line.name}"? Everyone in it is removed, any swap payment still on hold is refunded, and you lose access to its settlement page. Export it first if you need a record. This can't be undone.`}
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
              <h1 className="text-2xl font-semibold tracking-tight">Edit Line</h1>
              <p className="text-sm text-ink/60 mt-1">
                {line.currentCount} {isRestaurant ? (line.currentCount === 1 ? "party" : "parties") : line.currentCount === 1 ? "person" : "people"} currently in line
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
                role="switch"
                aria-checked={isPublic}
                aria-label="Public line"
                onClick={() => setIsPublic(!isPublic)}
                className={`relative inline-flex h-6 w-11 items-center transition-colors ${
                  isPublic ? "bg-ink" : "bg-rule"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform bg-white transition-transform ${
                    isPublic ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <div>
                <label className="text-sm font-medium text-ink">Public Line</label>
                <p className="text-xs text-ink/50">
                  {isPublic ? "Anyone can find this line in Browse" : "Only people with the link can join"}
                </p>
              </div>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center space-x-3">
              <button
                type="button"
                role="switch"
                aria-checked={isActive}
                aria-label="Line open (not paused)"
                onClick={() => setIsActive(!isActive)}
                className={`relative inline-flex h-6 w-11 items-center transition-colors ${
                  isActive ? "bg-green-700" : "bg-rule"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform bg-white transition-transform ${
                    isActive ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <div>
                <label className="text-sm font-medium text-ink">Active</label>
                <p className="text-xs text-ink/50">
                  {isActive ? "Line is accepting joins" : "Line is paused - no new joins allowed"}
                </p>
                {!isActive && enableSchedule && opensAt && new Date(opensAt) > new Date() && (
                  <p className="text-xs text-amber-700 mt-1">
                    This line is scheduled to open, but it&apos;s paused, so it won&apos;t open then and nobody gets the
                    &quot;it&apos;s open&quot; email. Turn it on to open on schedule.
                  </p>
                )}
              </div>
            </div>

            {/* Capacity */}
            <div>
              <label htmlFor="maxCapacity" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
                {isRestaurant ? "Max Guests (optional)" : "Max Capacity (optional)"}
              </label>
              <input
                id="maxCapacity"
                type="number"
                min={line.capacityUsed || 1}
                placeholder="Unlimited"
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
              />
              <p className="text-xs text-ink/50 mt-1">
                {line.capacityUsed > 0
                  ? `Must be at least ${line.capacityUsed} (${isRestaurant ? "guests waiting" : "spots already taken"})`
                  : isRestaurant ? "Total guests across all parties. Leave empty for no limit" : "Leave empty for unlimited spots"}
              </p>
              {maxCapacity && (
                <label className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    checked={hideCapacity}
                    onChange={(e) => setHideCapacity(e.target.checked)}
                    className="w-4 h-4 accent-ink border-rule"
                  />
                  <span className="text-sm text-ink/70">Hide capacity from members</span>
                </label>
              )}
              {maxCapacity && hideCapacity && (
                <p className="text-xs text-ink/50 mt-1">
                  Members will see &quot;Limited spots available&quot; instead of the exact number
                </p>
              )}
            </div>

            {/* Owner Fee */}
            <div>
              <label htmlFor="ownerFee" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
                Your Fee on Position Swaps (%)
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
                className="w-full px-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
              />
              <p className="text-xs text-ink/50 mt-1">
                Percentage you earn when someone swaps a position.
                {ownerFeePercent && parseFloat(ownerFeePercent) > 0 && (
                  <span className="text-accent ml-1">
                    e.g. on a $10 swap, you earn ${(10 * parseFloat(ownerFeePercent) / 100).toFixed(2)}.
                  </span>
                )}
                <span> A {platformFeePercent}% platform fee also applies to each swap.</span>
              </p>
              {parseFloat(ownerFeePercent) > 0 && !allowResale && (
                <p className="text-xs text-amber-600 mt-1">
                  Swaps are off, so this fee won&apos;t apply. Turn on swapping in Swap Settings below.
                </p>
              )}
              {parseFloat(ownerFeePercent) > 0 && needsPayoutSetup && (
                <p className="text-xs text-amber-600 mt-1">
                  Connect a payout account to receive this fee. Anything you earn before then is held and sent once you connect.{" "}
                  <Link href="/profile" className="underline underline-offset-4 hover:text-ink">
                    Set up payouts
                  </Link>
                </p>
              )}
              {(parseFloat(ownerFeePercent) || 0) !== line.ownerFeePercent && (
                <p className="text-xs text-amber-600 mt-1">
                  Changing the fee will update all displayed prices immediately. Purchases already in progress will keep their original fees.
                </p>
              )}
            </div>

            {/* Purchase limit (drops) and time to show up when called */}
            <div className="grid sm:grid-cols-2 gap-4">
              {!(isRestaurant) && (
                <div>
                  <label htmlFor="purchaseLimit" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
                    Limit per customer (optional)
                  </label>
                  <input
                    id="purchaseLimit"
                    type="number"
                    min="1"
                    max="99"
                    placeholder="No limit"
                    value={purchaseLimit}
                    onChange={(e) => setPurchaseLimit(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
                  />
                  <p className="text-xs text-ink/50 mt-1">e.g. 1 per person. Shown on the line page and when someone is called.</p>
                </div>
              )}
              <div>
                <label htmlFor="responseWindow" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
                  Time to show up when called (optional)
                </label>
                <input
                  id="responseWindow"
                  type="number"
                  min="1"
                  max="60"
                  placeholder="No limit"
                  value={responseWindow}
                  onChange={(e) => setResponseWindow(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
                />
                <p className="text-xs text-ink/50 mt-1">
                  Minutes. Anyone who doesn&apos;t show up in time is skipped as a no-show and the next person moves up. Tapping &ldquo;On my way&rdquo; gives them one more window.
                </p>
              </div>
            </div>

            {/* Schedule Toggle */}
            <div className="flex items-center space-x-3">
              <button
                type="button"
                role="switch"
                aria-checked={enableSchedule}
                aria-label="Schedule opening and closing times"
                onClick={() => setEnableSchedule(!enableSchedule)}
                className={`relative inline-flex h-6 w-11 items-center transition-colors ${
                  enableSchedule ? "bg-ink" : "bg-rule"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform bg-white transition-transform ${
                    enableSchedule ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <div>
                <label className="text-sm font-medium text-ink">Schedule Open/Close Times</label>
                <p className="text-xs text-ink/50">
                  {enableSchedule
                    ? "Line will only accept joins during the scheduled window"
                    : "No scheduled open/close times"}
                </p>
              </div>
            </div>

            {enableSchedule && (
              <div className="space-y-4 pl-4 border-l-2 border-rule">
                <div>
                  <label htmlFor="opensAt" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
                    Opens At
                  </label>
                  <input
                    id="opensAt"
                    type="datetime-local"
                    value={opensAt}
                    onChange={(e) => setOpensAt(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
                  />
                  <p className="text-xs text-ink/50 mt-1">Leave empty to open immediately</p>
                </div>
                <div>
                  <label htmlFor="closesAt" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
                    Closes At
                  </label>
                  <input
                    id="closesAt"
                    type="datetime-local"
                    value={closesAt}
                    onChange={(e) => setClosesAt(e.target.value)}
                    min={opensAt || undefined}
                    className="w-full px-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
                  />
                  <p className="text-xs text-ink/50 mt-1">Leave empty for no end time</p>
                </div>
              </div>
            )}

            {/* Product Details (collapsible) */}
            <div className="border border-rule">
              <button
                type="button"
                onClick={() => setShowProductDetails(!showProductDetails)}
                className="w-full flex items-center justify-between px-4 py-3 font-mono text-xs uppercase tracking-widest text-ink/60 hover:bg-paper transition-colors"
              >
                <span>Product Details (optional)</span>
                <svg
                  className={`h-4 w-4 text-ink/40 transition-transform ${showProductDetails ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showProductDetails && (
                <div className="px-4 pb-4 space-y-4 border-t border-rule pt-4">
                  <div>
                    <label htmlFor="productName" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
                      Product Name
                    </label>
                    <input
                      id="productName"
                      type="text"
                      placeholder='e.g., Nike Dunk Low Travis Scott'
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
                    />
                  </div>
                  <div>
                    <label htmlFor="productImage" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
                      Product Image URL
                    </label>
                    <input
                      id="productImage"
                      type="url"
                      placeholder="https://example.com/image.jpg"
                      value={productImage}
                      onChange={(e) => setProductImage(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
                    />
                  </div>
                  <div>
                    <label htmlFor="productPrice" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
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
                      className="w-full px-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
                    />
                  </div>
                  <div>
                    <label htmlFor="productUrl" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
                      Product Link
                    </label>
                    <input
                      id="productUrl"
                      type="url"
                      placeholder="https://example.com/product"
                      value={productUrl}
                      onChange={(e) => setProductUrl(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Swap Settings (collapsible) */}
            <div className="border border-rule">
              <button
                type="button"
                onClick={() => setShowResaleControls(!showResaleControls)}
                className="w-full flex items-center justify-between px-4 py-3 font-mono text-xs uppercase tracking-widest text-ink/60 hover:bg-paper transition-colors"
              >
                <span>Swap Settings (optional)</span>
                <svg
                  className={`h-4 w-4 text-ink/40 transition-transform ${showResaleControls ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showResaleControls && (
                <div className="px-4 pb-4 space-y-4 border-t border-rule pt-4">
                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={allowResale}
                      aria-label="Allow position swapping"
                      onClick={() => setAllowResale(!allowResale)}
                      className={`relative inline-flex h-6 w-11 items-center transition-colors ${
                        allowResale ? "bg-ink" : "bg-rule"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform bg-white transition-transform ${
                          allowResale ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                    <div>
                      <label className="text-sm font-medium text-ink">
                        Allow position swapping
                      </label>
                      <p className="text-xs text-ink/50">
                        {allowResale
                          ? "People can swap their positions with the person next to them"
                          : "Swapping is disabled — no one can swap positions"}
                      </p>
                      {allowResale && (
                        <p className="text-xs text-ink/50 mt-1">
                          {isRestaurant
                            ? "Paid swaps are held until the buyer is seated. Seating them collects the payment; before then you can release it."
                            : "Paid swaps are final: the buyer is charged and the seller is paid out right away, with no refunds later."}
                        </p>
                      )}
                      {line.allowResale && !allowResale && (
                        <p className="text-xs text-amber-600 mt-1">
                          Saving takes down every spot listed for sale and cancels pending offers.
                        </p>
                      )}
                    </div>
                  </div>
                  {allowResale && (
                    <div>
                      <label htmlFor="maxAskingPrice" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
                        Max Asking Price (optional)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink/50">$</span>
                        <input
                          id="maxAskingPrice"
                          type="number"
                          min="1"
                          step="0.01"
                          placeholder="No limit"
                          value={maxAskingPrice}
                          onChange={(e) => setMaxAskingPrice(e.target.value)}
                          className="w-full pl-7 pr-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
                        />
                      </div>
                      <p className="text-xs text-ink/50 mt-1">
                        Cap the maximum swap price anyone can set for their position. Leave empty for no limit.
                      </p>
                      {line.allowResale && maxAskingPrice && parseFloat(maxAskingPrice) >= 1 &&
                        (line.maxAskingPrice === null || parseFloat(maxAskingPrice) < line.maxAskingPrice) && (
                        <p className="text-xs text-amber-600 mt-1">
                          Saving takes down listings above this price and cancels offers and checkouts over it.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && name.trim() && (
              <div className="bg-white border border-accent p-3">
                <p className="text-sm text-accent">{error}</p>
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
