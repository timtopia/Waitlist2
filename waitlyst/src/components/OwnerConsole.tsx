"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { Button } from "./ui/Button"
import { ConfirmModal } from "./ui/ConfirmModal"
import { useToast } from "./ui/Toast"
import { formatCurrency } from "@/lib/format"

interface ConsolePosition {
  id: string
  position: number
  fulfilled: boolean
  lockedUntil: string | null
  user: { id: string; name: string | null }
}

interface OwnerConsoleProps {
  lineId: string
  isActive: boolean
  nowServing: string | null
  ownerFeePercent: number
  positions: ConsolePosition[]
  stripeEnabled: boolean
  hasPayoutSetup: boolean
  justCreated?: boolean
  onDismissCreated?: () => void
  onChanged: () => void
}

interface Earnings {
  earned: number
  pending: number
}

// Mirrors the call-next route's fallback so we can tell whether the person
// at the head of the queue is the one already called.
function calledName(name: string | null) {
  return name || "Next person"
}

export function OwnerConsole({
  lineId,
  isActive,
  nowServing,
  ownerFeePercent,
  positions,
  stripeEnabled,
  hasPayoutSetup,
  justCreated = false,
  onDismissCreated,
  onChanged,
}: OwnerConsoleProps) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [copied, setCopied] = useState(false)

  const waiting = positions.filter((p) => !p.fulfilled)
  const served = positions.filter((p) => p.fulfilled)
  const upNext = waiting[0] ?? null
  const afterNext = waiting[1] ?? null
  const isServingUpNext = !!upNext && nowServing === calledName(upNext.user.name)
  const upNextLocked = !!upNext?.lockedUntil && new Date(upNext.lockedUntil) > new Date()

  const fetchEarnings = useCallback(async () => {
    try {
      const res = await fetch(`/api/lines/${lineId}/stats`)
      if (res.ok) {
        const data = await res.json()
        setEarnings({ earned: data.ownerFeeEarned ?? 0, pending: data.ownerFeePending ?? 0 })
      }
    } catch {
      // Non-critical
    }
  }, [lineId])

  useEffect(() => {
    fetchEarnings()
  }, [fetchEarnings, positions.length, served.length])

  async function post(path: string, body?: unknown) {
    const res = await fetch(`/api/lines/${lineId}/${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  }

  async function handleCall() {
    setBusy("call")
    try {
      const { ok, data } = await post("call-next")
      if (ok) {
        addToast(`Called ${data.calledUser} to the front`, "success")
      } else {
        addToast(data.error || "Failed to call next person", "error")
      }
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  async function handleServe(callNext: boolean) {
    if (!upNext) return
    setBusy(callNext ? "serve-next" : "serve")
    try {
      const fulfilled = await post("fulfill", { positionId: upNext.id })
      if (!fulfilled.ok) {
        addToast(fulfilled.data.error || "Failed to mark as served", "error")
        return
      }
      const name = upNext.user.name || "Guest"
      if (callNext && afterNext) {
        const called = await post("call-next")
        addToast(
          called.ok ? `${name} served -- called ${called.data.calledUser}` : `${name} served`,
          called.ok ? "success" : "info"
        )
      } else {
        addToast(`${name} marked as served`, "success")
      }
    } finally {
      setBusy(null)
      onChanged()
    }
  }

  async function handleTogglePause() {
    setBusy("pause")
    try {
      const { ok, data } = await post("pause")
      if (ok) {
        addToast(data.isActive ? "Line resumed -- people can join again" : "Line paused -- no new joins or swaps", "success")
      } else {
        addToast(data.error || "Failed to update line", "error")
      }
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  async function handleClearServed() {
    setShowClearConfirm(false)
    setBusy("clear")
    try {
      const { ok, data } = await post("batch-remove", {
        positionIds: served.map((p) => p.id),
        action: "payout",
      })
      if (ok) {
        addToast(
          data.failed > 0
            ? `Cleared ${data.removed}, ${data.failed} could not be removed`
            : `Cleared ${data.removed} served ${data.removed === 1 ? "person" : "people"} -- everyone else moved up`,
          data.failed > 0 ? "info" : "success"
        )
      } else {
        addToast(data.error || "Failed to clear served people", "error")
      }
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  async function handleConnectPayouts() {
    setBusy("connect")
    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: `/lines/${lineId}` }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        window.location.href = data.url
        return
      }
      addToast(data.error || "Failed to start payout setup", "error")
    } catch {
      addToast("Failed to start payout setup", "error")
    }
    setBusy(null)
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/lines/${lineId}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasEarnings = !!earnings && (earnings.earned > 0 || earnings.pending > 0)
  const showMoney = ownerFeePercent > 0 || hasEarnings
  const needsPayoutSetup = stripeEnabled && !hasPayoutSetup && showMoney

  return (
    <div className="mb-6 bg-white border border-ink" data-testid="owner-console">
      <ConfirmModal
        open={showClearConfirm}
        title="Clear served people"
        message={`Remove the ${served.length} ${served.length === 1 ? "person" : "people"} you've already served from the line? Everyone still waiting moves up. Their payments stay final.`}
        confirmLabel="Clear Served"
        isLoading={busy === "clear"}
        onConfirm={handleClearServed}
        onCancel={() => setShowClearConfirm(false)}
      />

      {justCreated && (
        <div className="border-b border-rule bg-paper px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">Your line is live. Share the link so people can join.</p>
              <div className="flex items-center gap-2 mt-2">
                <input
                  readOnly
                  aria-label="Line link"
                  value={typeof window !== "undefined" ? `${window.location.origin}/lines/${lineId}` : `/lines/${lineId}`}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 font-mono text-xs px-3 py-2 bg-white border border-rule text-ink/70"
                />
                <Button size="sm" onClick={handleCopyLink}>
                  {copied ? "Copied!" : "Copy Link"}
                </Button>
              </div>
              <p className="text-xs text-ink/50 mt-1.5">
                Use Share above for a printable QR code or a website embed.
              </p>
            </div>
            {onDismissCreated && (
              <button
                onClick={onDismissCreated}
                className="text-ink/40 hover:text-ink flex-shrink-0"
                aria-label="Dismiss"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-rule">
        <div className="flex items-center gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink/60">Run your line</p>
          <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest ${isActive ? "text-green-700" : "text-amber-600"}`}>
            <span className={`w-1.5 h-1.5 ${isActive ? "bg-green-600" : "bg-amber-500"}`} aria-hidden />
            {isActive ? "Open" : "Paused"}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={handleTogglePause} isLoading={busy === "pause"}>
          {isActive ? "Pause" : "Resume"}
        </Button>
      </div>

      <div className="px-4 py-4">
        {!upNext ? (
          <p className="text-sm text-ink/60">
            {positions.length === 0
              ? "No one in line yet. Share the link to get people in."
              : "Everyone in line has been served."}
          </p>
        ) : (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="font-mono text-xs uppercase tracking-widest text-ink/50">
                {isServingUpNext ? "Now serving" : "Up next"}
              </p>
              <p className="text-lg font-semibold tracking-tight truncate">
                <span className="font-mono tabular-nums text-accent mr-2">#{upNext.position}</span>
                {upNext.user.name || "Anonymous"}
              </p>
              {upNextLocked && (
                <p className="text-xs text-amber-600">A swap for this spot is in progress -- wait for it to finish before serving.</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isServingUpNext ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => handleServe(!!afterNext)}
                    isLoading={busy === "serve-next"}
                    disabled={!!busy || upNextLocked}
                  >
                    {afterNext ? "Done · Call Next" : "Mark Served"}
                  </Button>
                  {afterNext && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleServe(false)}
                      isLoading={busy === "serve"}
                      disabled={!!busy || upNextLocked}
                    >
                      Mark Served
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button size="sm" onClick={handleCall} isLoading={busy === "call"} disabled={!!busy}>
                    Call {upNext.user.name || "Next"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleServe(false)}
                    isLoading={busy === "serve"}
                    disabled={!!busy || upNextLocked}
                  >
                    Mark Served
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center gap-3 font-mono text-xs uppercase tracking-widest text-ink/50 tabular-nums">
          <span>{waiting.length} waiting</span>
          <span className="text-ink/20">·</span>
          <span>{served.length} served</span>
          {served.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={!!busy}
              className="text-accent hover:underline underline-offset-4 disabled:opacity-50"
            >
              Clear served
            </button>
          )}
        </div>
      </div>

      {showMoney && (
        <div className="px-4 py-3 border-t border-rule flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-ink/50">
              Your fees ({ownerFeePercent}% per swap)
            </p>
            <p className="font-mono tabular-nums text-green-700">
              {formatCurrency(earnings?.earned ?? 0)} earned
              {(earnings?.pending ?? 0) > 0 && (
                <span className="text-amber-600"> + {formatCurrency(earnings?.pending ?? 0)} pending</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {needsPayoutSetup && (
              <Button size="sm" variant="secondary" onClick={handleConnectPayouts} isLoading={busy === "connect"}>
                Set Up Payouts
              </Button>
            )}
            <Link
              href={`/lines/${lineId}/settlement`}
              className="font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
            >
              Settlement &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
