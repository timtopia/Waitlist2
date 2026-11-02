"use client"

import { Suspense, useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { signIn, useSession } from "next-auth/react"
import { Button } from "@/components/ui/Button"
import { Input, Textarea } from "@/components/ui/Input"
import { Card, CardContent } from "@/components/ui/Card"
import { useToast } from "@/components/ui/Toast"
import { calcFees } from "@/lib/fees"

const DRAFT_KEY = "waitlyst:new-line-draft"

export default function CreateLinePage() {
  return (
    <Suspense>
      <CreateLineForm />
    </Suspense>
  )
}

function CreateLineForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { addToast } = useToast()
  const { data: session, status } = useSession()
  const [connectOnboarded, setConnectOnboarded] = useState<boolean | null>(null)
  const [stripeEnabled, setStripeEnabled] = useState(false)
  const [platformFeePercent, setPlatformFeePercent] = useState<number | null>(null)
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
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
  const [allowResale, setAllowResale] = useState(false)
  const [kind, setKind] = useState<"STANDARD" | "RESTAURANT">("STANDARD")
  const [maxAskingPrice, setMaxAskingPrice] = useState("")
  const [purchaseLimit, setPurchaseLimit] = useState("")
  const [responseWindow, setResponseWindow] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<string>("custom")
  const nameRef = useRef<HTMLInputElement>(null)

  const templates = [
    {
      id: "restaurant-waitlist",
      icon: "\uD83C\uDF7D\uFE0F",
      name: "Restaurant Waitlist",
      desc: "Walk-ins wait anywhere",
      apply: () => {
        setMaxCapacity("")
        setOwnerFeePercent("0")
        setAllowResale(false)
        setHideCapacity(false)
        setDescription("Join the waitlist and we'll let you know when your table is ready.")
        setShowResaleControls(false)
        setKind("RESTAURANT")
      },
    },
    {
      id: "product-drop",
      icon: "\uD83C\uDFAF",
      name: "Product Drop",
      desc: "Limited release, tradable spots",
      apply: () => {
        setMaxCapacity("100")
        setOwnerFeePercent("10")
        setAllowResale(true)
        setHideCapacity(true)
        setDescription("Limited release drop")
        setShowResaleControls(true)
        setShowProductDetails(true)
        setKind("STANDARD")
      },
    },
    {
      id: "event-waitlist",
      icon: "\uD83D\uDCCB",
      name: "Event Waitlist",
      desc: "Capped list, guests can swap spots",
      apply: () => {
        setMaxCapacity("200")
        setOwnerFeePercent("0")
        setAllowResale(true)
        setHideCapacity(false)
        setDescription("Event waitlist. If your plans change, you can swap spots with the person next to you.")
        setShowResaleControls(true)
        setKind("STANDARD")
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

  useEffect(() => {
    if (!session) return
    fetch("/api/user")
      .then((res) => (res.ok ? res.json() : null))
      .then((user) => {
        setConnectOnboarded(user?.stripeConnectOnboarded ?? false)
        setStripeEnabled(!!user?.stripeEnabled)
        if (typeof user?.platformFeePercent === "number") setPlatformFeePercent(user.platformFeePercent)
      })
      .catch(() => setConnectOnboarded(false))
  }, [session])

  useEffect(() => {
    const connectStatus = searchParams.get("connect")
    if (connectStatus === "success") {
      setConnectOnboarded(true)
      addToast("Payout account connected -- your fees will now be paid out.", "success")
      router.replace("/lines/new", { scroll: false })
    } else if (connectStatus === "incomplete") {
      addToast("Payout setup isn't finished yet. Pick it back up whenever you're ready.", "info")
      router.replace("/lines/new", { scroll: false })
    } else if (connectStatus === "error") {
      addToast("Something went wrong connecting your payout account. Please try again.", "error")
      router.replace("/lines/new", { scroll: false })
    }
  }, [searchParams, router, addToast])

  // Connecting a payout account leaves for Stripe and comes back here, which
  // used to wipe everything typed so far. Keep a draft for the round trip.
  const draft = {
    name, description, isPublic, enableSchedule, opensAt, closesAt, maxCapacity, ownerFeePercent,
    showProductDetails, productName, productImage, productPrice, productUrl, hideCapacity,
    showResaleControls, allowResale, kind, maxAskingPrice, selectedTemplate,
    purchaseLimit, responseWindow,
  }
  useEffect(() => {
    const saved = sessionStorage.getItem(DRAFT_KEY)
    if (!saved) return
    sessionStorage.removeItem(DRAFT_KEY)
    try {
      const d = JSON.parse(saved) as typeof draft
      setName(d.name); setDescription(d.description); setIsPublic(d.isPublic)
      setEnableSchedule(d.enableSchedule); setOpensAt(d.opensAt); setClosesAt(d.closesAt)
      setMaxCapacity(d.maxCapacity); setOwnerFeePercent(d.ownerFeePercent)
      setShowProductDetails(d.showProductDetails); setProductName(d.productName)
      setProductImage(d.productImage); setProductPrice(d.productPrice); setProductUrl(d.productUrl)
      setHideCapacity(d.hideCapacity); setShowResaleControls(d.showResaleControls)
      setAllowResale(d.allowResale); setKind(d.kind); setMaxAskingPrice(d.maxAskingPrice)
      setSelectedTemplate(d.selectedTemplate)
      setPurchaseLimit(d.purchaseLimit ?? ""); setResponseWindow(d.responseWindow ?? "")
    } catch {
      // A damaged draft just means starting over
    }
  }, [])

  async function handleConnectSetup() {
    setConnectLoading(true)
    setConnectError(null)
    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: "/lines/new" }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
        window.location.href = data.url
      } else {
        setConnectError(data.error || "Failed to start payout setup")
        setConnectLoading(false)
      }
    } catch {
      setConnectError("Failed to start payout setup")
      setConnectLoading(false)
    }
  }

  if (status === "loading") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-ink/10 w-1/3 mb-8"></div>
          <div className="space-y-4">
            <div className="h-10 bg-ink/10"></div>
            <div className="h-24 bg-ink/10"></div>
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
            <p className="text-ink/60 mb-4">Sign in to start your first line. It takes about a minute.</p>
            <Button onClick={() => signIn("google", { callbackUrl: "/lines/new" })}>Sign in with Google</Button>
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
      nameRef.current?.focus()
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
          ownerFeePercent: allowResale && ownerFeePercent ? parseFloat(ownerFeePercent) : 0,
          productName: productName.trim() || null,
          productImage: productImage.trim() || null,
          productPrice: productPrice ? parseFloat(productPrice) : null,
          productUrl: productUrl.trim() || null,
          allowResale,
          maxAskingPrice: maxAskingPrice ? parseFloat(maxAskingPrice) : null,
          purchaseLimit: purchaseLimit && kind !== "RESTAURANT" ? parseInt(purchaseLimit, 10) : null,
          responseWindowMinutes: responseWindow ? parseInt(responseWindow, 10) : null,
          hideCapacity: maxCapacity ? hideCapacity : false,
          kind,
        }),
      })

      if (res.ok) {
        const line = await res.json()
        router.push(`/lines/${line.id}?created=1`)
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

  const ownerFeeNum = parseFloat(ownerFeePercent) || 0
  const exampleFees = calcFees(10, ownerFeeNum, platformFeePercent ?? 0)
  const feeHint =
    `Buyers pay this on top of the asking price${platformFeePercent ? `, plus a ${platformFeePercent}% platform fee` : ""}: ` +
    `a $10 spot costs them $${exampleFees.total.toFixed(2)}` +
    `${ownerFeeNum > 0 ? ` and you earn $${exampleFees.ownerFee.toFixed(2)}` : ""}.`

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
      <div className="border-b border-ink pb-6 mb-10">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-ink/60 mb-3">
          Open for business
        </p>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">Create a New Line</h1>
        <p className="text-ink/60 mt-3">
          Create a virtual queue for others to join
        </p>
      </div>
      <Card>
        <CardContent className="py-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Quick-start templates */}
            <div>
              <label className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
                Quick Start
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl.id)}
                    className={`flex flex-col items-start text-left border-2 p-3 transition-colors ${
                      selectedTemplate === tpl.id
                        ? "border-accent bg-white"
                        : "border-rule bg-white hover:border-ink"
                    }`}
                  >
                    <span className="text-sm font-semibold tracking-tight">{tpl.name}</span>
                    <span className="text-xs text-ink/60 mt-0.5 leading-tight">{tpl.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <Input
              ref={nameRef}
              id="name"
              label="Line Name"
              placeholder={kind === "RESTAURANT" ? "e.g., Friday dinner waitlist" : 'e.g., Air Max 1 "Chicago" drop'}
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
                role="switch"
                aria-checked={isPublic}
                aria-label="Public line"
                onClick={() => setIsPublic(!isPublic)}
                className={`relative inline-flex h-6 w-11 items-center transition-colors ${
                  isPublic ? "bg-ink" : "bg-ink/20"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform bg-white transition-transform ${
                    isPublic ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <div>
                <label className="font-mono text-xs uppercase tracking-widest text-ink/60">
                  Public Line
                </label>
                <p className="text-xs text-ink/60">
                  {isPublic
                    ? "Anyone can find this line in Browse"
                    : "Only people with the link can join"}
                </p>
              </div>
            </div>

            {/* Line type */}
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={kind === "RESTAURANT"}
                onChange={(e) => setKind(e.target.checked ? "RESTAURANT" : "STANDARD")}
                className="w-4 h-4 mt-0.5 accent-ink"
              />
              <span>
                <span className="block text-sm text-ink">Restaurant waitlist</span>
                <span className="block text-xs text-ink/60 mt-0.5">
                  {kind === "RESTAURANT"
                    ? "Guests give a party size, capacity counts guests, and you can call any party. Paid swaps are held on the buyer's card until you seat them, so you can still release them if the evening goes wrong."
                    : "Everyone holds one spot and is called in order. Paid swaps are collected and paid out as soon as they happen."}
                </span>
              </span>
            </label>

            {/* Capacity */}
            <div>
              <label htmlFor="maxCapacity" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
                {kind === "RESTAURANT" ? "Max Guests (optional)" : "Max Capacity (optional)"}
              </label>
              <input
                id="maxCapacity"
                type="number"
                min="1"
                placeholder="Unlimited"
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
              />
              <p className="text-xs text-ink/60 mt-1">
                {kind === "RESTAURANT" ? "Total guests across all parties. Leave empty for no limit" : "Leave empty for unlimited spots"}
              </p>
              {maxCapacity && (
                <label className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    checked={hideCapacity}
                    onChange={(e) => setHideCapacity(e.target.checked)}
                    className="w-4 h-4 accent-ink"
                  />
                  <span className="text-sm text-ink/70">Hide capacity from members</span>
                </label>
              )}
              {maxCapacity && hideCapacity && (
                <p className="text-xs text-ink/60 mt-1">
                  Members will see &quot;Limited spots available&quot; instead of the exact number
                </p>
              )}
            </div>

            {/* Purchase limit (drops) and time to show up when called */}
            <div className="grid sm:grid-cols-2 gap-4">
              {!(kind === "RESTAURANT") && (
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
                  <p className="text-xs text-ink/60 mt-1">e.g. 1 per person. Shown on the line page and when someone is called.</p>
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
                <p className="text-xs text-ink/60 mt-1">
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
                  enableSchedule ? "bg-ink" : "bg-ink/20"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform bg-white transition-transform ${
                    enableSchedule ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <div>
                <label className="font-mono text-xs uppercase tracking-widest text-ink/60">
                  Schedule Open/Close Times
                </label>
                <p className="text-xs text-ink/60">
                  {enableSchedule
                    ? "Line will only accept joins during the scheduled window"
                    : "Line is open immediately with no end time"}
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
                  <p className="text-xs text-ink/60 mt-1">
                    Leave empty to open immediately
                  </p>
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
                  <p className="text-xs text-ink/60 mt-1">
                    Leave empty for no end time
                  </p>
                </div>
              </div>
            )}

            {/* Product Details (collapsible) */}
            <div className="border border-rule">
              <button
                type="button"
                onClick={() => setShowProductDetails(!showProductDetails)}
                className="w-full flex items-center justify-between px-4 py-3 font-mono text-xs uppercase tracking-widest text-ink/70 hover:bg-paper transition-colors"
              >
                <span>Product Details (optional)</span>
                <svg
                  className={`h-4 w-4 text-ink/60 transition-transform ${showProductDetails ? "rotate-180" : ""}`}
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
                      placeholder={`e.g., Air Max 1 "Chicago" or Chef's tasting menu`}
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
                className="w-full flex items-center justify-between px-4 py-3 font-mono text-xs uppercase tracking-widest text-ink/70 hover:bg-paper transition-colors"
              >
                <span>Swap Settings (optional)</span>
                <svg
                  className={`h-4 w-4 text-ink/60 transition-transform ${showResaleControls ? "rotate-180" : ""}`}
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
                        allowResale ? "bg-ink" : "bg-ink/20"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform bg-white transition-transform ${
                          allowResale ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                    <div>
                      <label className="font-mono text-xs uppercase tracking-widest text-ink/60">
                        Allow position swapping
                      </label>
                      <p className="text-xs text-ink/60">
                        {allowResale
                          ? "People can swap their positions with the person next to them"
                          : "Swapping is disabled — no one can swap positions"}
                      </p>
                      {allowResale && (
                        <p className="text-xs text-ink/60 mt-1">
                          {kind === "RESTAURANT"
                            ? "Paid swaps are held until the buyer is seated. Seating them collects the payment; before then you can release it."
                            : "Paid swaps are final: the buyer is charged and the seller is paid out right away, with no refunds later."}
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
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink/60">$</span>
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
                      <p className="text-xs text-ink/60 mt-1">
                        Cap the maximum swap price anyone can set for their position. Leave empty for no limit.
                      </p>
                    </div>
                  )}
                  {/* Owner Fee */}
                  {allowResale && (
                    <div>
                      <label htmlFor="ownerFee" className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
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
                          className="w-full px-3 py-2 bg-white border border-rule text-sm focus:outline-none focus:border-ink"
                        />
                      </div>
                      <p className="text-xs text-ink/60 mt-1">
                        {feeHint}
                      </p>
                      {ownerFeePercent && parseFloat(ownerFeePercent) > 0 && stripeEnabled && connectOnboarded === false && (
                        <div className="mt-2 flex items-center justify-between gap-3 bg-accent/5 border border-accent/30 px-3 py-2">
                          <p className="text-xs text-ink/70">
                            Connect a payout account to receive this fee. Anything you earn before then is held and sent once you connect.
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={handleConnectSetup}
                            isLoading={connectLoading}
                            className="flex-shrink-0"
                          >
                            Connect Now
                          </Button>
                        </div>
                      )}
                      {connectError && (
                        <p className="text-xs text-accent mt-1">{connectError}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && name.trim() && (
              <p role="alert" className="text-sm text-accent">{error}</p>
            )}

            <div className="flex justify-end space-x-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push("/dashboard")}
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
