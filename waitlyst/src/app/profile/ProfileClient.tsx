"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { formatDate, formatDateTime, formatCurrency } from "@/lib/format"

interface UserData {
  id: string
  name: string | null
  email: string | null
  image: string | null
  createdAt: string
}

interface Stats {
  linesCreated: number
  activePositions: number
  totalTransactions: number
  sellerAvailable: number
  sellerPendingSettlement: number
  sellerPendingPayment: number
  ownerAvailable: number
  ownerPendingSettlement: number
  ownerPendingPayment: number
  purchaseCount: number
  saleCount: number
}

interface Transaction {
  id: string
  amount: number
  status: string
  role: "buyer" | "seller"
  createdAt: string
  settledAt: string | null
}

interface ProfileClientProps {
  user: UserData
  stats: Stats
  recentTransactions: Transaction[]
  stripeConnectOnboarded: boolean
  emailNotifications: boolean
}

const statusColors: Record<string, string> = {
  COMPLETED: "text-green-700",
  PENDING: "text-amber-600",
  FAILED: "text-accent",
  REFUNDED: "text-ink/40",
}

export function ProfileClient({ user, stats, recentTransactions, stripeConnectOnboarded, emailNotifications }: ProfileClientProps) {
  const [displayName, setDisplayName] = useState(user.name || "Anonymous")
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(user.name || "")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connectOnboarded, setConnectOnboarded] = useState(stripeConnectOnboarded)
  const [connectMessage, setConnectMessage] = useState<{ text: string; type: "success" | "info" | "error" } | null>(null)
  const [emailNotifs, setEmailNotifs] = useState(emailNotifications)
  const [emailNotifsLoading, setEmailNotifsLoading] = useState(false)
  const [visibleCount, setVisibleCount] = useState(5)
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const connectStatus = searchParams.get("connect")
    if (connectStatus === "success") {
      setConnectOnboarded(true)
      setConnectMessage({ text: "Payout account connected successfully!", type: "success" })
      router.replace("/profile", { scroll: false })
    } else if (connectStatus === "incomplete") {
      setConnectMessage({ text: "Payout setup is not complete. Please finish the onboarding process.", type: "info" })
      router.replace("/profile", { scroll: false })
    } else if (connectStatus === "error") {
      setConnectMessage({ text: "Something went wrong connecting your payout account. Please try again.", type: "error" })
      router.replace("/profile", { scroll: false })
    }
  }, [searchParams, router])

  async function handleSave() {
    const trimmed = editValue.trim()
    if (trimmed.length === 0 || trimmed.length > 50) {
      setError("Name must be between 1 and 50 characters")
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to update name")
      }

      const updated = await res.json()
      setDisplayName(updated.name || "Anonymous")
      setIsEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update name")
    } finally {
      setIsSaving(false)
    }
  }

  function handleCancel() {
    setEditValue(displayName === "Anonymous" ? "" : displayName)
    setError(null)
    setIsEditing(false)
  }

  function handleStartEdit() {
    setEditValue(displayName === "Anonymous" ? "" : displayName)
    setError(null)
    setIsEditing(true)
  }

  async function handleConnectSetup() {
    setConnectLoading(true)
    setConnectError(null)
    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: "/profile" }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
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

  async function handleViewDashboard() {
    setConnectLoading(true)
    setConnectError(null)
    try {
      const res = await fetch("/api/stripe/connect/dashboard", { method: "POST" })
      const data = await res.json()
      if (res.ok && data.url) {
        window.open(data.url, "_blank")
      } else {
        setConnectError(data.error || "Failed to open Stripe dashboard")
      }
    } catch {
      setConnectError("Failed to open Stripe dashboard")
    } finally {
      setConnectLoading(false)
    }
  }

  async function handleToggleEmailNotifs() {
    setEmailNotifsLoading(true)
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailNotifications: !emailNotifs }),
      })
      if (res.ok) {
        setEmailNotifs(!emailNotifs)
      }
    } catch {
      // Silently fail
    } finally {
      setEmailNotifsLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
      {/* Connect Status Banner */}
      {connectMessage && (
        <div className={`mb-6 bg-white border p-4 ${
          connectMessage.type === "success"
            ? "border-green-700 text-green-800"
            : connectMessage.type === "info"
            ? "border-amber-500 text-amber-700"
            : "border-accent text-accent"
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{connectMessage.text}</p>
            <button
              onClick={() => setConnectMessage(null)}
              className="ml-4 text-current opacity-50 hover:opacity-75"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* User Info */}
      <Card className="mb-6">
        <CardContent className="py-6">
          <div className="flex items-center gap-4">
            {user.image ? (
              <Image
                src={user.image}
                alt={displayName}
                width={64}
                height={64}
                className="border border-rule"
              />
            ) : (
              <div className="w-16 h-16 bg-ink flex items-center justify-center text-paper text-2xl font-semibold">
                {displayName[0] || "U"}
              </div>
            )}
            <div className="flex-1">
              {isEditing ? (
                <div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSave()
                        if (e.key === "Escape") handleCancel()
                      }}
                      maxLength={50}
                      autoFocus
                      className="text-2xl font-semibold tracking-tight bg-white border border-rule px-2 py-1 focus:outline-none focus:border-ink w-full max-w-xs"
                    />
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="p-1.5 text-green-700 hover:bg-ink/5 disabled:opacity-50"
                      title="Save"
                    >
                      {isSaving ? (
                        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={isSaving}
                      className="p-1.5 text-ink/40 hover:bg-ink/5 disabled:opacity-50"
                      title="Cancel"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {error && (
                    <p className="text-xs text-accent mt-1">{error}</p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight">{displayName}</h1>
                  <button
                    onClick={handleStartEdit}
                    className="p-1 text-ink/40 hover:text-ink hover:bg-ink/5"
                    title="Edit name"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </div>
              )}
              {user.email && (
                <p className="text-sm text-ink/60">{user.email}</p>
              )}
              <p className="font-mono text-xs text-ink/40 mt-1">
                Member since {formatDate(user.createdAt)}
              </p>
            </div>
            <Link href="/dashboard">
              <Button variant="secondary" size="sm">Dashboard</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Stats & Balances */}
      <Card className="mb-6">
        <CardContent className="py-5">
          <div className="flex items-center justify-between font-mono text-xs uppercase tracking-wider text-ink/50 mb-4">
            <span>{stats.linesCreated} lines created</span>
            <span className="text-ink/20">·</span>
            <span>{stats.activePositions} active positions</span>
            <span className="text-ink/20">·</span>
            <span>{stats.purchaseCount} swaps made</span>
            <span className="text-ink/20">·</span>
            <span>{stats.saleCount} swaps received</span>
          </div>

          {/* Total Available — hero number */}
          <div className="border border-ink p-5 text-center mb-4">
            <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mb-1">Total Available</p>
            <p className="font-mono text-3xl tabular-nums text-green-700">
              {formatCurrency(stats.sellerAvailable + stats.ownerAvailable)}
            </p>
            <p className="text-xs text-ink/40 mt-1">Ready to withdraw</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Seller Earnings */}
            <div className="border border-rule p-4">
              <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Swap Earnings</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-green-600 flex-shrink-0" aria-hidden />
                    <span className="text-sm text-ink/60">Available</span>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-green-700">
                    {formatCurrency(stats.sellerAvailable)}
                  </span>
                </div>
                {stats.sellerPendingSettlement > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-amber-500 flex-shrink-0" aria-hidden />
                      <span className="text-sm text-ink/60">Pending settlement</span>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-amber-600">
                      {formatCurrency(stats.sellerPendingSettlement)}
                    </span>
                  </div>
                )}
                {stats.sellerPendingPayment > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-ink/20 flex-shrink-0" aria-hidden />
                      <span className="text-sm text-ink/60">Pending payment</span>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-ink/40">
                      {formatCurrency(stats.sellerPendingPayment)}
                    </span>
                  </div>
                )}
              </div>
              {(stats.sellerPendingSettlement > 0 || stats.sellerPendingPayment > 0) && (
                <p className="text-xs text-ink/40 mt-3 pt-2 border-t border-rule">
                  {stats.sellerPendingSettlement > 0 && "Settlement completes when both parties leave the line. "}
                  {stats.sellerPendingPayment > 0 && "Pending payments are transactions in progress."}
                </p>
              )}
            </div>

            {/* Owner Fee Earnings */}
            <div className="border border-rule p-4">
              <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Owner Fee Earnings</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-green-600 flex-shrink-0" aria-hidden />
                    <span className="text-sm text-ink/60">Available</span>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-green-700">
                    {formatCurrency(stats.ownerAvailable)}
                  </span>
                </div>
                {stats.ownerPendingSettlement > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-amber-500 flex-shrink-0" aria-hidden />
                      <span className="text-sm text-ink/60">Pending settlement</span>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-amber-600">
                      {formatCurrency(stats.ownerPendingSettlement)}
                    </span>
                  </div>
                )}
                {stats.ownerPendingPayment > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-ink/20 flex-shrink-0" aria-hidden />
                      <span className="text-sm text-ink/60">Pending payment</span>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-ink/40">
                      {formatCurrency(stats.ownerPendingPayment)}
                    </span>
                  </div>
                )}
              </div>
              {(stats.ownerPendingSettlement > 0 || stats.ownerPendingPayment > 0) && (
                <p className="text-xs text-ink/40 mt-3 pt-2 border-t border-rule">
                  {stats.ownerPendingSettlement > 0 && "Settlement completes when both parties leave the line. "}
                  {stats.ownerPendingPayment > 0 && "Pending payments are transactions in progress."}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payout Settings */}
      <Card className="mb-6">
        <CardContent className="py-5">
          <h2 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Payout Settings</h2>
          {connectOnboarded ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-green-700">
                  <span className="w-1.5 h-1.5 bg-green-600" aria-hidden />
                  Payouts Active
                </span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleViewDashboard}
                isLoading={connectLoading}
              >
                View Stripe Dashboard
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-ink/60">
                Connect a payout account to receive earnings from swapping positions and line owner fees.
              </p>
              <Button
                size="sm"
                onClick={handleConnectSetup}
                isLoading={connectLoading}
                className="ml-4 flex-shrink-0"
              >
                {stripeConnectOnboarded === false && !connectOnboarded
                  ? "Set Up Payouts"
                  : "Complete Payout Setup"}
              </Button>
            </div>
          )}
          {connectError && (
            <p className="text-xs text-accent mt-2">{connectError}</p>
          )}
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card className="mb-6">
        <CardContent className="py-5">
          <h2 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Notification Settings</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Email Notifications</p>
              <p className="text-xs text-ink/50 mt-0.5">
                Receive emails when you&apos;re called, get swap offers, or are fulfilled
              </p>
            </div>
            <button
              onClick={handleToggleEmailNotifs}
              disabled={emailNotifsLoading}
              className={`relative inline-flex h-6 w-11 items-center transition-colors focus:outline-none focus:ring-2 focus:ring-ink focus:ring-offset-2 disabled:opacity-50 ${
                emailNotifs ? "bg-ink" : "bg-ink/20"
              }`}
              role="switch"
              aria-checked={emailNotifs}
            >
              <span
                className={`inline-block h-4 w-4 transform bg-white transition-transform ${
                  emailNotifs ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60">
            Recent Transactions ({stats.totalTransactions} total)
          </h2>
        </CardHeader>
        <CardContent>
          {recentTransactions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-ink/60 mb-2">No transactions yet.</p>
              <p className="text-sm text-ink/40">
                Swap a position in a line to see your transaction history here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentTransactions.slice(0, visibleCount).map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-3 bg-paper"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-1.5 h-1.5 flex-shrink-0 ${
                        tx.role === "buyer" ? "bg-accent" : "bg-green-600"
                      }`}
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-medium">
                        {tx.role === "buyer" ? "Swapped up" : "Swapped down"}
                      </p>
                      <p className="font-mono text-xs text-ink/40">{formatDateTime(tx.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-mono text-xs uppercase tracking-widest ${statusColors[tx.status] || "text-ink/50"}`}>
                      {tx.status}
                    </span>
                    <p className={`font-mono text-sm tabular-nums ${
                      tx.role === "buyer" ? "text-accent" : "text-green-700"
                    }`}>
                      {tx.role === "buyer" ? "-" : "+"}{formatCurrency(tx.amount)}
                    </p>
                  </div>
                </div>
              ))}
              {visibleCount < recentTransactions.length && (
                <div className="pt-2 flex justify-center gap-3">
                  <button
                    onClick={() => setVisibleCount((c) => c + 5)}
                    className="font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink"
                  >
                    Show more
                  </button>
                  <span className="text-ink/20">·</span>
                  <button
                    onClick={() => setVisibleCount(recentTransactions.length)}
                    className="font-mono text-xs uppercase tracking-widest text-ink/50 hover:text-ink"
                  >
                    View all {recentTransactions.length} transactions
                  </button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
