"use client"

import { useState, useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import { useToast } from "@/components/ui/Toast"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { buttonClasses } from "@/components/ui/buttonStyles"
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
  sellerAwaitingSetup?: number
  sellerPendingSettlement: number
  sellerPendingPayment: number
  ownerAvailable: number
  ownerAwaitingSetup?: number
  ownerPendingSettlement: number
  ownerPendingPayment: number
  purchaseCount: number
  saleCount: number
}

interface Transaction {
  id: string
  amount: number
  /** null if the line has since been deleted */
  lineName: string | null
  status: string
  statusLabel: string
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
  /** Hide the email setting until the server can actually send email */
  emailEnabled?: boolean
  /** No payments on this site yet: "Set Up Payouts" would only error */
  stripeEnabled?: boolean
}

const statusColors: Record<string, string> = {
  COMPLETED: "text-green-700",
  PENDING: "text-amber-700",
  FAILED: "text-accent",
  REFUNDED: "text-ink/60",
}

export function ProfileClient({ user, stats, recentTransactions, stripeConnectOnboarded, emailNotifications, emailEnabled = true, stripeEnabled = true }: ProfileClientProps) {
  const [displayName, setDisplayName] = useState(user.name || "Anonymous")
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(user.name || "")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connectOnboarded, setConnectOnboarded] = useState(stripeConnectOnboarded)
  const awaitingSetup = (stats.sellerAwaitingSetup ?? 0) + (stats.ownerAwaitingSetup ?? 0)
  const [connectMessage, setConnectMessage] = useState<{ text: string; type: "success" | "info" | "error" } | null>(null)
  const [emailNotifs, setEmailNotifs] = useState(emailNotifications)
  const { update: updateSession } = useSession()
  const { addToast } = useToast()
  // Save/Cancel unmount the input; put focus back where editing started
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const refocusEdit = () => requestAnimationFrame(() => editButtonRef.current?.focus())
  const [emailNotifsLoading, setEmailNotifsLoading] = useState(false)
  const [emailNotifsError, setEmailNotifsError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(5)
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const connectStatus = searchParams.get("connect")
    if (connectStatus === "success") {
      setConnectOnboarded(true)
      setConnectMessage({ text: "Payout account connected successfully!", type: "success" })
      router.replace("/profile", { scroll: false })
    } else if (connectStatus === "pending") {
      setConnectMessage({ text: "Stripe is verifying your details -- usually minutes, sometimes a day or two. Anything you earn meanwhile is held and paid out automatically once it's approved.", type: "info" })
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

      // A proxy error page isn't JSON; don't show the parser's message
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Couldn't update your name. Try again.")
        return
      }

      setDisplayName(data.name || "Anonymous")
      setIsEditing(false)
      refocusEdit()
      addToast("Name updated", "success")
      // The header reads the session; refresh it so it shows the new name
      updateSession().catch(() => {})
    } catch {
      setError("No connection -- your name wasn't saved. Try again.")
    } finally {
      setIsSaving(false)
    }
  }

  function handleCancel() {
    setEditValue(displayName === "Anonymous" ? "" : displayName)
    setError(null)
    setIsEditing(false)
    refocusEdit()
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
      const data = await res.json().catch(() => ({}))
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
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) {
        // Not window.open: after an await, iPhone Safari blocks it as a pop-up
        // and the tap silently does nothing
        window.location.href = data.url
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
    setEmailNotifsError(null)
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailNotifications: !emailNotifs }),
      })
      if (res.ok) {
        setEmailNotifs(!emailNotifs)
      } else {
        // The switch used to just not move, with no hint why
        const data = await res.json().catch(() => ({}))
        setEmailNotifsError(data.error || "Couldn't update your email setting. Please try again.")
      }
    } catch {
      setEmailNotifsError("Couldn't reach the server. Check your connection and try again.")
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
              className="ml-4 text-current p-2.5 -m-2.5 inline-flex hover:opacity-75"
              aria-label="Dismiss"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                      aria-invalid={!!error}
                      aria-describedby={error ? "name-error" : undefined}
                      aria-label="Display name"
                      autoFocus
                      className="text-2xl font-semibold tracking-tight bg-white border border-rule px-2 py-1 focus:outline-none focus:border-ink w-full max-w-xs"
                    />
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="p-1.5 min-h-11 min-w-11 pointer-fine:min-h-0 pointer-fine:min-w-0 inline-flex items-center justify-center text-green-700 hover:bg-ink/5 disabled:opacity-50"
                      title="Save"
                      aria-label="Save name"
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
                      className="p-1.5 min-h-11 min-w-11 pointer-fine:min-h-0 pointer-fine:min-w-0 inline-flex items-center justify-center text-ink/60 hover:bg-ink/5 disabled:opacity-50"
                      title="Cancel"
                      aria-label="Cancel editing name"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {error && (
                    <p id="name-error" className="text-xs text-accent mt-1" role="alert">{error}</p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight">{displayName}</h1>
                  <button
                    ref={editButtonRef}
                    onClick={handleStartEdit}
                    className="p-1 text-ink/60 hover:text-ink hover:bg-ink/5"
                    title="Edit name"
                    aria-label="Edit name"
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
              <p className="font-mono text-xs text-ink/60 mt-1">
                Member since {formatDate(user.createdAt)}
              </p>
            </div>
            <Link href="/dashboard" className={buttonClasses({ variant: "secondary", size: "sm" })}>Dashboard</Link>
          </div>
        </CardContent>
      </Card>

      {/* Stats & Balances */}
      <Card className="mb-6">
        <CardContent className="py-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-xs uppercase tracking-wider text-ink/60 mb-4">
            <span>{stats.linesCreated} {stats.linesCreated === 1 ? "line" : "lines"} created</span>
            <span className="text-ink/20">·</span>
            <span>{stats.activePositions} active {stats.activePositions === 1 ? "position" : "positions"}</span>
            <span className="text-ink/20">·</span>
            <span>{stats.purchaseCount} {stats.purchaseCount === 1 ? "spot" : "spots"} bought</span>
            <span className="text-ink/20">·</span>
            <span>{stats.saleCount} {stats.saleCount === 1 ? "spot" : "spots"} sold</span>
          </div>

          {/* Total Available — hero number */}
          <div className="border border-ink p-5 text-center mb-4">
            <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-1">Paid to You</p>
            <p className="font-mono text-3xl tabular-nums text-green-700">
              {formatCurrency(stats.sellerAvailable + stats.ownerAvailable)}
            </p>
            <p className="text-xs text-ink/60 mt-1">Sent to your payout account</p>
          </div>

          {awaitingSetup > 0 && (
            <div className="border border-accent/40 bg-accent/5 px-4 py-3 mb-4">
              <p className="text-sm text-ink">
                {formatCurrency(awaitingSetup)} has been collected for you and is waiting.
                {connectOnboarded
                  ? " We're retrying the transfer to your payout account. If it's still here later, check your payout account for anything Stripe needs from you."
                  : " Set up payouts below to receive it."}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Seller Earnings */}
            <div className="border border-rule p-4">
              <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Swap Earnings</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-green-600 flex-shrink-0" aria-hidden />
                    <span className="text-sm text-ink/60">Paid out</span>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-green-700">
                    {formatCurrency(stats.sellerAvailable)}
                  </span>
                </div>
                {(stats.sellerAwaitingSetup ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-accent flex-shrink-0" aria-hidden />
                      <span className="text-sm text-ink/60">{connectOnboarded ? "Payout retrying" : "Waiting on payout setup"}</span>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-accent">
                      {formatCurrency(stats.sellerAwaitingSetup ?? 0)}
                    </span>
                  </div>
                )}
                {stats.sellerPendingSettlement > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-amber-500 flex-shrink-0" aria-hidden />
                      <span className="text-sm text-ink/60">On hold</span>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-amber-700">
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
                    <span className="font-mono text-sm tabular-nums text-ink/60">
                      {formatCurrency(stats.sellerPendingPayment)}
                    </span>
                  </div>
                )}
              </div>
              {(stats.sellerPendingSettlement > 0 || stats.sellerPendingPayment > 0) && (
                <p className="text-xs text-ink/60 mt-3 pt-2 border-t border-rule">
                  {stats.sellerPendingSettlement > 0 && "The buyer's card is on hold: you're paid once they're seated, or once the organizer collects it from the settlement page. "}
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
                    <span className="text-sm text-ink/60">Paid out</span>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-green-700">
                    {formatCurrency(stats.ownerAvailable)}
                  </span>
                </div>
                {(stats.ownerAwaitingSetup ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-accent flex-shrink-0" aria-hidden />
                      <span className="text-sm text-ink/60">{connectOnboarded ? "Payout retrying" : "Waiting on payout setup"}</span>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-accent">
                      {formatCurrency(stats.ownerAwaitingSetup ?? 0)}
                    </span>
                  </div>
                )}
                {stats.ownerPendingSettlement > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-amber-500 flex-shrink-0" aria-hidden />
                      <span className="text-sm text-ink/60">On hold</span>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-amber-700">
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
                    <span className="font-mono text-sm tabular-nums text-ink/60">
                      {formatCurrency(stats.ownerPendingPayment)}
                    </span>
                  </div>
                )}
              </div>
              {(stats.ownerPendingSettlement > 0 || stats.ownerPendingPayment > 0) && (
                <p className="text-xs text-ink/60 mt-3 pt-2 border-t border-rule">
                  {stats.ownerPendingSettlement > 0 && "Held fees are collected when the buyer is seated (restaurants), or are payments that couldn't be collected yet (drops). "}
                  {stats.ownerPendingPayment > 0 && "Pending payments are transactions in progress."}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payout Settings */}
      {(stripeEnabled || connectOnboarded) && (
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
                Only needed if you sell your spot in a line or charge a fee on lines you run.
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
            <p className="text-xs text-accent mt-2" role="alert">{connectError}</p>
          )}
        </CardContent>
      </Card>
      )}

      {/* Notification Settings */}
      {emailEnabled && (
      <Card className="mb-6">
        <CardContent className="py-5">
          <h2 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Notification Settings</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Email Notifications</p>
              <p className="text-xs text-ink/60 mt-0.5">
                Emails when you&apos;re next or called, served, skipped or removed, get or win a swap offer,
                a sale or refund goes through, a line you&apos;re in is deleted, or a line you asked about opens.
                With this off, you&apos;ll only find out by checking the page.
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
              aria-label="Email notifications"
            >
              <span
                className={`inline-block h-4 w-4 transform bg-white transition-transform ${
                  emailNotifs ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          {emailNotifsError && (
            <p className="text-xs text-accent mt-2" role="alert">{emailNotifsError}</p>
          )}
        </CardContent>
      </Card>
      )}

      {/* Your data: the privacy policy promises export and deletion on request,
          so say how from the account page instead of leaving people to hunt */}
      <Card className="mb-6">
        <CardContent className="py-5">
          <h2 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Your Data</h2>
          <p className="text-sm text-ink/60">
            Other people in a line see your first name and last initial; the line&apos;s
            owner sees your full name and email. Lines you create show your display
            name and profile picture to anyone who opens them, including link previews.{" "}
            <Link href="/privacy" className="text-accent hover:underline underline-offset-4">
              Privacy policy
            </Link>
          </p>
          <p className="text-sm text-ink/60 mt-2">
            Want a copy of your data, or your account deleted?{" "}
            <a
              href="mailto:support@waitlyst.app?subject=Waitlyst%20account%20request"
              className="text-accent hover:underline underline-offset-4"
            >
              Email support@waitlyst.app
            </a>{" "}
            from the address you sign in with.
          </p>
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60">
            Transactions ({stats.totalTransactions})
          </h2>
        </CardHeader>
        <CardContent>
          {recentTransactions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-ink/60 mb-2">No transactions yet.</p>
              <p className="text-sm text-ink/60">
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
                        {tx.role === "buyer" ? "Bought a spot" : "Sold your spot"}
                        {tx.lineName && <span className="text-ink/60 font-normal"> in {tx.lineName}</span>}
                      </p>
                      <p className="font-mono text-xs text-ink/60">
                        {formatDateTime(tx.createdAt)}
                        {tx.settledAt && tx.status === "REFUNDED" && ` · refunded ${formatDateTime(tx.settledAt)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-mono text-xs uppercase tracking-widest ${statusColors[tx.status] || "text-ink/60"}`}>
                      {tx.statusLabel}
                    </span>
                    <p className={`font-mono text-sm tabular-nums ${
                      tx.role === "buyer" ? "text-accent" : "text-green-700"
                    }`}>
                      {tx.status === "REFUNDED" ? "" : tx.role === "buyer" ? "-" : "+"}{formatCurrency(tx.amount)}
                    </p>
                  </div>
                </div>
              ))}
              {visibleCount < recentTransactions.length && (
                <div className="pt-2 flex justify-center gap-3">
                  <button
                    onClick={() => setVisibleCount((c) => c + 5)}
                    className="font-mono text-xs uppercase tracking-widest text-ink/60 hover:text-ink"
                  >
                    Show more
                  </button>
                  <span className="text-ink/20">·</span>
                  <button
                    onClick={() => setVisibleCount(recentTransactions.length)}
                    className="font-mono text-xs uppercase tracking-widest text-ink/60 hover:text-ink"
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
