"use client"

import Link from "next/link"
import { useDialog } from "@/lib/use-dialog"
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
  calledAt?: string | null
  response?: "ON_MY_WAY" | "RUNNING_LATE" | null
  partySize?: number
  user: { id: string; name: string | null }
}

interface OwnerConsoleProps {
  lineId: string
  isActive: boolean
  nowServingUserId: string | null
  ownerFeePercent: number
  positions: ConsolePosition[]
  stripeEnabled: boolean
  hasPayoutSetup: boolean
  justCreated?: boolean
  onDismissCreated?: () => void
  onChanged: () => void
  isRestaurant?: boolean
  /** Paid swaps are on, so there can be payments to review even with no owner fee */
  allowResale?: boolean
  purchaseLimit?: number | null
}

interface Earnings {
  earned: number
  pending: number
}

interface Pace {
  medianWaitMinutes: number | null
  servedLastHour: number
}

/** "4 × 2, 1 × 6" -- the waiting parties by size, biggest group first */
function partyMix(parties: ConsolePosition[]): string {
  const bySize = new Map<number, number>()
  for (const p of parties) bySize.set(p.partySize ?? 1, (bySize.get(p.partySize ?? 1) ?? 0) + 1)
  return [...bySize.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([size, count]) => `${count} × ${size}`)
    .join(", ")
}

export function OwnerConsole({
  lineId,
  isActive,
  nowServingUserId,
  ownerFeePercent,
  positions,
  stripeEnabled,
  hasPayoutSetup,
  justCreated = false,
  onDismissCreated,
  allowResale = false,
  purchaseLimit = null,
  onChanged,
  isRestaurant = false,
}: OwnerConsoleProps) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [closeChoice, setCloseChoice] = useState(false)
  const closeDialogRef = useDialog(closeChoice, () => setCloseChoice(false))
  const [pace, setPace] = useState<Pace | null>(null)
  const [walkInOpen, setWalkInOpen] = useState(false)
  const [walkInName, setWalkInName] = useState("")
  const [walkInSize, setWalkInSize] = useState(2)
  const [walkInNote, setWalkInNote] = useState("")
  const [copied, setCopied] = useState(false)

  const waiting = positions.filter((p) => !p.fulfilled)
  const served = positions.filter((p) => p.fulfilled)
  const upNext = waiting[0] ?? null
  const afterNext = waiting[1] ?? null
  const isServingUpNext = !!upNext && (!!upNext.calledAt || nowServingUserId === upNext.user.id)
  const upNextLocked = !!upNext?.lockedUntil && new Date(upNext.lockedUntil) > new Date()

  const fetchEarnings = useCallback(async () => {
    try {
      const res = await fetch(`/api/lines/${lineId}/stats`)
      if (res.ok) {
        const data = await res.json()
        setEarnings({ earned: data.ownerFeeEarned ?? 0, pending: data.ownerFeePending ?? 0 })
        if (data.service) {
          // The console is for right now: a typical wait over all time would
          // let a slow Tuesday drag down tonight's number
          setPace({ medianWaitMinutes: data.service.recentMedianWaitMinutes, servedLastHour: data.service.servedLastHour })
        }
      }
    } catch {
      // Non-critical
    }
  }, [lineId])

  // A swap changes the order but not the counts, and it's what earns a fee
  const order = positions.map((p) => p.user.id).join(",")
  useEffect(() => {
    fetchEarnings()
  }, [fetchEarnings, positions.length, served.length, order])

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
    if (!upNext) return
    setBusy("call")
    try {
      // Name who the button showed, so a queue that moved since can't make
      // this call someone else
      const { ok, data } = await post("call-next", { positionId: upNext.id })
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
      if (callNext && afterNext?.calledAt) {
        // Already called out of order: calling again would wipe their
        // "on my way" and send them a second "you've been called"
        addToast(`${name} served -- ${afterNext.user.name || "the next party"} was already called`, "success")
      } else if (callNext && afterNext) {
        const called = await post("call-next", { positionId: afterNext.id })
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
      const { ok, data } = await post("pause", { isActive: !isActive })
      if (ok) {
        addToast(data.isActive ? "Line resumed -- people can join again" : "Line paused -- no new joins or swaps, and it's hidden from Browse until you resume", "success")
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

  /**
   * End of the night: stop new joins and empty the list in one step. Payments
   * still on hold are kept (collected) or refunded, as the owner chooses.
   */
  async function handleClose(action: "payout" | "refund") {
    setCloseChoice(false)
    setBusy("close")
    try {
      const paused = isActive ? await post("pause", { isActive: false }) : { ok: true, data: {} }
      if (!paused.ok) {
        addToast(paused.data.error || "Failed to close the line", "error")
        return
      }
      if (positions.length > 0) {
        const { ok, data } = await post("batch-remove", { positionIds: positions.map((p) => p.id), action })
        if (!ok) {
          addToast(data.error || "The line is paused, but clearing it failed", "error")
          return
        }
        const moneyProblems = (data.refundFailedCount ?? 0) + (data.collectFailedCount ?? 0)
        addToast(
          moneyProblems > 0
            ? `Closed. ${moneyProblems} payment(s) need attention on the settlement page.`
            : `Closed for now: the line is paused and empty.`,
          moneyProblems > 0 ? "info" : "success"
        )
      } else {
        addToast("Closed for now: the line is paused.", "success")
      }
    } finally {
      setBusy(null)
      onChanged()
    }
  }

  /** Someone at the stand with no account or phone gets a place too */
  async function handleAddWalkIn(e: React.FormEvent) {
    e.preventDefault()
    if (!walkInName.trim()) return
    setBusy("walk-in")
    try {
      const { ok, data } = await post("walk-in", {
        name: walkInName.trim(),
        ...(isRestaurant && { partySize: walkInSize, note: walkInNote }),
      })
      if (ok) {
        addToast(`Added ${walkInName.trim()} at #${data.position}`, "success")
        setWalkInName("")
        setWalkInNote("")
        setWalkInSize(2)
        setWalkInOpen(false)
      } else {
        addToast(data.error || "Failed to add the walk-in", "error")
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
  // Restaurant holds need the settlement page even when the owner takes no fee
  const showMoney = ownerFeePercent > 0 || hasEarnings || allowResale
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

      {closeChoice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Close the line">
          <div ref={closeDialogRef} className="bg-white border border-ink max-w-md w-full p-6">
            <h3 className="text-lg font-semibold tracking-tight text-ink mb-2">
              {isRestaurant ? "Close for the night?" : "Close the line?"}
            </h3>
            <p className="text-sm text-ink/60 mb-4">
              This pauses the line so no one new can join, and removes all {positions.length}{" "}
              {positions.length === 1 ? "person" : "people"} still on it. Everyone still waiting is told they&apos;re no longer in line.
              {allowResale && " Choose what happens to swap payments still on hold:"}
            </p>
            <div className="flex flex-col space-y-2">
              <Button onClick={() => handleClose("payout")} isLoading={busy === "close"} className="w-full">
                {allowResale ? "Close and keep payments" : "Close the line"}
              </Button>
              {allowResale && (
                <Button variant="danger" onClick={() => handleClose("refund")} isLoading={busy === "close"} className="w-full">
                  Close and refund held payments
                </Button>
              )}
              <Button variant="ghost" onClick={() => setCloseChoice(false)} className="w-full">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

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
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={handleTogglePause} isLoading={busy === "pause"}>
            {isActive ? "Pause" : "Resume"}
          </Button>
          {(isActive || positions.length > 0) && (
            <Button size="sm" variant="ghost" onClick={() => setCloseChoice(true)} isLoading={busy === "close"}>
              {isRestaurant ? "Close for the night" : "Close"}
            </Button>
          )}
        </div>
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
              {isServingUpNext && upNext.response && (
                <p className={`text-xs ${upNext.response === "ON_MY_WAY" ? "text-green-700" : "text-amber-600"}`}>
                  {upNext.response === "ON_MY_WAY" ? "Says they're on the way" : "Says they're running late"}
                </p>
              )}
              {purchaseLimit && (
                <p className="text-xs text-ink/60">Limit {purchaseLimit} per person</p>
              )}
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
                    {isRestaurant && ` (party of ${upNext.partySize ?? 1})`}
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

        {(isRestaurant && waiting.length > 0) || (pace && (pace.servedLastHour > 0 || pace.medianWaitMinutes !== null)) ? (
          <p className="mt-3 text-xs text-ink/60">
            {isRestaurant && waiting.length > 0 && (
              <span>
                Waiting parties by size: <span className="font-mono tabular-nums">{partyMix(waiting)}</span>
              </span>
            )}
            {isRestaurant && waiting.length > 0 && pace && (pace.servedLastHour > 0 || pace.medianWaitMinutes !== null) && " · "}
            {pace && (pace.servedLastHour > 0 || pace.medianWaitMinutes !== null) && (
              <span>
                {pace.servedLastHour} {isRestaurant ? "seated" : "served"} in the last hour
                {pace.medianWaitMinutes !== null && <>, typical wait lately {Math.round(pace.medianWaitMinutes)} min</>}
              </span>
            )}
          </p>
        ) : null}

        {walkInOpen ? (
          <form onSubmit={handleAddWalkIn} className="mt-3 flex flex-wrap items-end gap-2 border border-rule p-3">
            <label className="flex flex-col text-xs text-ink/60">
              Name
              <input
                autoFocus
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                maxLength={50}
                required
                className="mt-1 border border-rule bg-white px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-ink"
              />
            </label>
            {isRestaurant && (
              <>
                <label className="flex flex-col text-xs text-ink/60">
                  Party of
                  <select
                    value={walkInSize}
                    onChange={(e) => setWalkInSize(Number(e.target.value))}
                    className="mt-1 border border-rule bg-white px-2 py-1.5 text-sm text-ink"
                  >
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col text-xs text-ink/60 flex-1 min-w-[10rem]">
                  Note (optional)
                  <input
                    value={walkInNote}
                    onChange={(e) => setWalkInNote(e.target.value)}
                    maxLength={140}
                    placeholder="high chair, patio..."
                    className="mt-1 border border-rule bg-white px-2 py-1.5 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:border-ink"
                  />
                </label>
              </>
            )}
            <Button size="sm" type="submit" isLoading={busy === "walk-in"} disabled={!walkInName.trim()}>
              Add to line
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setWalkInOpen(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <button
            onClick={() => setWalkInOpen(true)}
            className="mt-3 font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
          >
            + Add walk-in
          </button>
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
          <Link
            href={`/lines/${lineId}/analytics`}
            className="ml-auto text-accent hover:underline underline-offset-4"
          >
            Analytics &rarr;
          </Link>
        </div>
      </div>

      {showMoney && (
        <div className="px-4 py-3 border-t border-rule flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-ink/50">
              {ownerFeePercent > 0 ? `Your fees (${ownerFeePercent}% per swap)` : "Paid swaps"}
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
