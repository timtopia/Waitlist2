"use client"

import Link from "next/link"
import { useDialog } from "@/lib/use-dialog"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "./ui/Button"
import { ConfirmModal } from "./ui/ConfirmModal"
import { useToast } from "./ui/Toast"
import { formatCurrency, formatDateTime, formatWaited } from "@/lib/format"
import { callDeadline, timeLeft } from "@/lib/call-deadline"
import { MAX_PARTY_SIZE } from "@/lib/capacity"
import { batchRemove } from "@/lib/batch-remove-client"

interface ConsolePosition {
  id: string
  position: number
  fulfilled: boolean
  lockedUntil: string | null
  calledAt?: string | null
  response?: "ON_MY_WAY" | "RUNNING_LATE" | null
  respondedAt?: string | null
  graceMinutes?: number
  partySize?: number
  /** Host-only: high chair, patio... */
  note?: string | null
  joinedAt?: string
  user: { id: string; name: string | null; isWalkIn?: boolean }
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
  onChanged: () => void | Promise<void>
  isRestaurant?: boolean
  /** Paid swaps are on, so there can be payments to review even with no owner fee */
  allowResale?: boolean
  purchaseLimit?: number | null
  /** Minutes a called party has to show up; null when there's no limit */
  responseWindowMinutes?: number | null
  /** An announcement is posted; closing the line clears it */
  hasAnnouncement?: boolean
  /** Scheduled opening/closing times; joins are refused outside them */
  opensAt?: string | null
  closesAt?: string | null
  /** Guests (or spots) still free on a capped line; null when uncapped */
  roomLeft?: number | null
}

interface Earnings {
  earned: number
  pending: number
  /** Settled paid swaps on this line */
  swaps: number
}

interface Pace {
  medianWaitMinutes: number | null
  servedLastHour: number
}

/** "4 × 2, 1 × 6" -- the waiting parties by size, smallest first */
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
  responseWindowMinutes = null,
  hasAnnouncement = false,
  opensAt = null,
  closesAt = null,
  roomLeft = null,
}: OwnerConsoleProps) {
  const nowMs = Date.now()
  const notYetOpen = !!opensAt && new Date(opensAt).getTime() > nowMs
  const closedBySchedule = !!closesAt && new Date(closesAt).getTime() <= nowMs
  const { addToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  // Seating a party that was never called can't be undone: confirm it
  const [seatUncalledConfirm, setSeatUncalledConfirm] = useState(false)
  // Whoever the host tapped No-show on: the party up next or one also called
  const [noShowTarget, setNoShowTarget] = useState<ConsolePosition | null>(null)
  const [closeChoice, setCloseChoice] = useState(false)
  const closeDialogRef = useDialog(closeChoice, () => setCloseChoice(false))
  const [pace, setPace] = useState<Pace | null>(null)
  const [walkInOpen, setWalkInOpen] = useState(false)
  const [walkInName, setWalkInName] = useState("")
  const [walkInSize, setWalkInSize] = useState(2)
  const walkInMax = Math.max(1, Math.min(MAX_PARTY_SIZE, roomLeft ?? MAX_PARTY_SIZE))
  const walkInParty = Math.min(walkInSize, walkInMax)
  const [walkInNote, setWalkInNote] = useState("")
  const [copied, setCopied] = useState(false)
  const walkInButtonRef = useRef<HTMLButtonElement>(null)
  const walkInNameRef = useRef<HTMLInputElement>(null)
  const [copyAnnounce, setCopyAnnounce] = useState("")
  // Back from Stripe's payout setup (back/forward cache) left busy on
  // "connect", with every Call/Seat/No-show button still greyed out
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(null)
    }
    window.addEventListener("pageshow", onShow)
    return () => window.removeEventListener("pageshow", onShow)
  }, [])
  // Hand focus back to "+ Add walk-in" when the form closes, not on first render
  const walkInWasOpen = useRef(false)
  useEffect(() => {
    if (walkInOpen) {
      walkInWasOpen.current = true
    } else if (walkInWasOpen.current) {
      walkInWasOpen.current = false
      walkInButtonRef.current?.focus()
    }
  }, [walkInOpen])
  // Ticks so a called party's "4 min left" keeps up between polls
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const waiting = positions.filter((p) => !p.fulfilled)
  const served = positions.filter((p) => p.fulfilled)
  const upNext = waiting[0] ?? null
  const afterNext = waiting[1] ?? null
  // Already called out of order: serving the up-next party won't call anyone
  const canCallAfterNext = !!afterNext && !afterNext.calledAt
  const isServingUpNext = !!upNext && (!!upNext.calledAt || nowServingUserId === upNext.user.id)
  const upNextLocked = !!upNext?.lockedUntil && new Date(upNext.lockedUntil) > new Date()
  // Restaurants seat parties; everyone else serves people
  const servedWord = isRestaurant ? "seated" : "served"
  const markServedLabel = isRestaurant ? "Mark Seated" : "Mark Served"
  // Only restaurant swaps sit on hold until seating; drop swaps settle at once
  const heldPayments = allowResale && isRestaurant
  // Parties called out of order, or still called behind the one up next
  const alsoCalled = waiting.slice(1).filter((p) => p.calledAt)
  // Restaurant rows are numbered among parties still waiting (seated rows show a check),
  // so the console quotes the same number the list does
  const placeOf = (p: (typeof positions)[number]) =>
    isRestaurant ? waiting.indexOf(p) + 1 : p.position

  /** Time left for a called party to show up, as QueueDisplay counts it */
  function showUpTimeLeft(p: ConsolePosition): string | null {
    // Walk-ins have no phone to answer, and paused lines hold the timers
    if (!p.calledAt || !responseWindowMinutes || p.user.isWalkIn || !isActive) return null
    return timeLeft(callDeadline(p.calledAt, responseWindowMinutes, p.respondedAt, p.graceMinutes), clock)
  }

  /** "called 6 min ago": how long a party has had to get to the stand */
  function calledAgo(p: ConsolePosition): string | null {
    if (!p.calledAt) return null
    const minutes = Math.floor((clock - new Date(p.calledAt).getTime()) / 60_000)
    return minutes < 1 ? "called just now" : `called ${formatWaited(minutes)} ago`
  }

  /** Their show-up timer exists but is frozen because the line is paused */
  function timerOnHold(p: ConsolePosition): boolean {
    return !!p.calledAt && !!responseWindowMinutes && !p.user.isWalkIn && !isActive
  }

  // A called party whose time ran out is skipped by the server on the next
  // poll and just vanishes from the console. Say so, so the host isn't left
  // wondering where the party they called went.
  const removedByHost = useRef(new Set<string>())
  const lastCalled = useRef<ConsolePosition[]>([])
  useEffect(() => {
    const now = Date.now()
    const present = new Set(positions.map((p) => p.id))
    const skipped = isActive && responseWindowMinutes
      ? lastCalled.current.filter((p) => {
          if (present.has(p.id) || removedByHost.current.has(p.id)) return false
          const deadline = callDeadline(p.calledAt, responseWindowMinutes, p.respondedAt, p.graceMinutes)
          // No slack: a party the host removed from the list moments before
          // their time ran out must not be reported as timed out
          return !!deadline && deadline.getTime() <= now
        })
      : []
    if (skipped.length > 0) {
      // A burst of lapsed calls at a busy drop made a screen-tall toast
      const named = skipped.map((p) => p.user.name || "A party")
      const names = named.length > 3 ? `${named.slice(0, 2).join(", ")} and ${named.length - 2} others` : named.join(", ")
      // All we know is they're gone and their time had run out: the timer,
      // another device, the list below or the guest themselves may have done it
      addToast(
        `${names} ${skipped.length === 1 ? "is" : "are"} no longer in line (their time to show up had run out)`,
        "info"
      )
    }
    lastCalled.current = positions.filter((p) => !p.fulfilled && p.calledAt && !p.user.isWalkIn)
  }, [positions, isActive, responseWindowMinutes, addToast])

  const fetchEarnings = useCallback(async () => {
    try {
      const res = await fetch(`/api/lines/${lineId}/stats`)
      if (res.ok) {
        const data = await res.json()
        setEarnings({ earned: data.ownerFeeEarned ?? 0, pending: data.ownerFeePending ?? 0, swaps: (data.completedCount ?? 0) + (data.pendingSettlementCount ?? 0) })
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

  // A swap changes the order but not the counts, and it's what earns a fee.
  // Stats are the heaviest owner query: a 2,000-person drop changes the
  // order on every join, so refetch at most every 30s unless someone was
  // served -- and every minute regardless, so "seated in the last hour"
  // doesn't freeze during a lull.
  const order = positions.map((p) => p.user.id).join(",")
  const lastEarningsFetch = useRef(0)
  const lastServedCount = useRef(-1)
  useEffect(() => {
    const servedChanged = served.length !== lastServedCount.current
    if (!servedChanged && Date.now() - lastEarningsFetch.current < 30_000) return
    lastServedCount.current = served.length
    lastEarningsFetch.current = Date.now()
    fetchEarnings()
  }, [fetchEarnings, served.length, order])
  useEffect(() => {
    const id = setInterval(() => {
      lastEarningsFetch.current = Date.now()
      fetchEarnings()
    }, 60_000)
    return () => clearInterval(id)
  }, [fetchEarnings])

  async function post(path: string, body?: unknown, method = "POST") {
    let res: Response
    try {
      res = await fetch(`/api/lines/${lineId}/${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch {
      // A Wi-Fi blip must read as a failure, not as nothing happening
      return { ok: false, data: { error: "No connection -- check your signal and try again" } }
    }
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  }

  /** Seating collects held swap payments; say so when one couldn't be collected */
  function warnPayoutsFailed(data: { payoutsFailed?: number }) {
    const failed = data.payoutsFailed ?? 0
    if (failed > 0) {
      addToast(
        `${failed} payment${failed === 1 ? "" : "s"} couldn't be collected -- review on the settlement page.`,
        "error"
      )
    }
  }

  async function handleCall() {
    if (!upNext) return
    setBusy("call")
    try {
      // Name who the button showed, so a queue that moved since can't make
      // this call someone else
      const { ok, data } = await post("call-next", { positionId: upNext.id })
      if (ok) {
        addToast(
          data.isWalkIn
            ? `${data.calledUser} is a walk-in -- call them out at the stand`
            : `Called ${data.calledUser} to the front`,
          "success"
        )
      } else {
        addToast(data.error || "Failed to call next person", "error")
      }
      await onChanged()
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
        addToast(fulfilled.data.error || `Failed to mark as ${servedWord}`, "error")
        return
      }
      const name = upNext.user.name || "Guest"
      warnPayoutsFailed(fulfilled.data)
      if (callNext && afterNext?.calledAt) {
        // Already called out of order: calling again would wipe their
        // "on my way" and send them a second "you've been called"
        addToast(`${name} ${servedWord} -- ${afterNext.user.name || "the next party"} was already called`, "success")
      } else if (callNext && afterNext) {
        const called = await post("call-next", { positionId: afterNext.id })
        if (!called.ok) {
          // The seat went through but nobody was called: the host must know
          // the next party is still waiting on a call
          addToast(
            `${name} ${servedWord}, but ${afterNext.user.name || "the next party"} wasn't called: ${called.data.error || "try calling them again"}`,
            "error"
          )
        } else {
          addToast(
            called.data.isWalkIn
              ? `${name} ${servedWord} -- ${called.data.calledUser} is a walk-in, call them out at the stand`
              : `${name} ${servedWord} -- called ${called.data.calledUser}`,
            "success"
          )
        }
      } else {
        addToast(`${name} marked as ${servedWord}`, "success")
      }
    } finally {
      await onChanged()
      setBusy(null)
    }
  }

  /** The called party never showed: skip them without digging through the list */
  async function handleNoShow() {
    const target = noShowTarget
    if (!target) return
    setNoShowTarget(null)
    removedByHost.current.add(target.id)
    setBusy(target.id === upNext?.id ? "no-show" : `no-show-${target.id}`)
    try {
      const { ok, data } = await post("remove-position", {
        positionId: target.id,
        action: "payout",
        noShow: true,
        // The call they saw: refused if another device acted on it since
        calledAt: target.calledAt ?? undefined,
        graceMinutes: target.graceMinutes ?? 0,
      })
      if (ok) addToast(`Marked ${target.user.name || "them"} as a no-show`, "success")
      else {
        // Not removed after all (re-called, more time or seated elsewhere)
        removedByHost.current.delete(target.id)
        addToast(data.error || "Couldn't mark as a no-show", "error")
      }
    } finally {
      await onChanged()
      setBusy(null)
    }
  }

  /** Running late and the host is happy to wait: more time without re-calling */
  async function handleGiveMoreTime(p: ConsolePosition) {
    setBusy(`grace-${p.id}`)
    try {
      const { ok, data } = await post("grace", { positionId: p.id })
      if (ok) addToast(`Gave ${p.user.name || "them"} 5 more minutes${data.graceMinutes > 5 ? ` (${data.graceMinutes} extra in all)` : ""}`, "success")
      else addToast(data.error || "Couldn't give more time", "error")
    } finally {
      await onChanged()
      setBusy(null)
    }
  }

  /** Seat a party that was called but isn't first in line */
  async function handleSeatAlsoCalled(p: ConsolePosition) {
    const name = p.user.name || "Guest"
    setBusy(`seat-${p.id}`)
    try {
      const { ok, data } = await post("fulfill", { positionId: p.id })
      if (ok) {
        addToast(`${name} marked as ${servedWord}`, "success")
        warnPayoutsFailed(data)
      } else {
        addToast(data.error || `Failed to mark as ${servedWord}`, "error")
      }
    } finally {
      await onChanged()
      setBusy(null)
    }
  }

  async function handleTogglePause() {
    setBusy("pause")
    try {
      const { ok, data } = await post("pause", { isActive: !isActive })
      if (ok) {
        addToast(
          data.isActive
            ? closedBySchedule
              ? "Line resumed, but it's past its closing time -- change the closing time in Edit to let people join"
              : notYetOpen && opensAt
                ? `Line resumed -- people can join from ${formatDateTime(opensAt, { withZone: true })}`
                : "Line resumed -- people can join again"
            : isRestaurant
              ? `Line paused -- no online joins${allowResale ? " or swaps" : ""} until you resume. Walk-ins and calls still work.`
              : "Line paused -- no new joins or swaps, and it's hidden from Browse until you resume",
          "success"
        )
      } else {
        addToast(data.error || "Failed to update line", "error")
      }
      await onChanged()
    } finally {
      setBusy(null)
    }
  }

  async function handleClearServed() {
    setShowClearConfirm(false)
    setBusy("clear")
    try {
      const { ok, data } = await batchRemove(lineId, served.map((p) => p.id), { action: "payout" })
      if (ok) {
        // Another device may have cleared some already: that's done, not failed
        const gone: number = data.alreadyGone ?? 0
        const cleared: number = data.removed + gone
        addToast(
          data.failed > 0
            ? `Cleared ${cleared}, ${data.failed} could not be removed`
            : // Restaurant numbers count waiting parties only, so nobody's changes
              `Cleared ${cleared} ${servedWord} ${isRestaurant ? (cleared === 1 ? "party" : "parties") : cleared === 1 ? "person" : "people"}${isRestaurant ? "" : " -- everyone else moved up"}`,
          data.failed > 0 ? "info" : "success"
        )
      } else {
        addToast(data.error || `Failed to clear ${servedWord} ${isRestaurant ? "parties" : "people"}`, "error")
      }
      await onChanged()
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
      // Tonight's "45 min wait, patio closed" shouldn't greet tomorrow's guests
      const announcementCleared = hasAnnouncement
        ? (await post("announcement", { announcement: null }, "PATCH")).ok
        : true
      const announcementNote = announcementCleared ? "" : " The announcement couldn't be cleared."
      // The list on screen can be a poll old; someone may have joined just
      // before the pause landed. Clear what the server has now.
      let ids = positions.map((p) => p.id)
      try {
        const fresh = await fetch(`/api/lines/${lineId}`, { cache: "no-store" })
        if (fresh.ok) {
          const latest = await fresh.json()
          if (Array.isArray(latest?.positions)) ids = latest.positions.map((p: { id: string }) => p.id)
        }
      } catch {
        // Offline: fall back to what's on screen
      }
      if (ids.length > 0) {
        for (const id of ids) removedByHost.current.add(id)
        const { ok, data } = await batchRemove(lineId, ids, { action, reason: "closed" })
        if (!ok) {
          addToast(data.error || "The line is paused, but clearing it failed", "error")
          return
        }
        const moneyProblems = (data.refundFailedCount ?? 0) + (data.collectFailedCount ?? 0)
        const notRemoved = data.failed ?? 0
        addToast(
          notRemoved > 0
            ? `Closed, but ${notRemoved} ${isRestaurant ? (notRemoved === 1 ? "party" : "parties") : notRemoved === 1 ? "person" : "people"} couldn't be removed -- check the list.${announcementNote}`
            : moneyProblems > 0
              ? `Closed. ${moneyProblems} payment(s) need attention on the settlement page.${announcementNote}`
              : `Closed for now: the line is paused and empty.${announcementNote}`,
          notRemoved > 0 || moneyProblems > 0 || !announcementCleared ? "info" : "success"
        )
      } else {
        addToast(`Closed for now: the line is paused.${announcementNote}`, announcementCleared ? "success" : "info")
      }
    } finally {
      await onChanged()
      setBusy(null)
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
        ...(isRestaurant && { partySize: walkInParty, note: walkInNote }),
      })
      if (ok && data.duplicate) {
        // The same name, size and note went in under a minute ago: either a
        // retry after a lost reply, or a different party with the same name.
        // Keep the form filled so a second party is one edit away.
        addToast(
          `${walkInName.trim()}${isRestaurant ? ` (party of ${walkInParty})` : ""} was already added a moment ago. If this is a different ${isRestaurant ? "party" : "person"}, add a last initial and try again.`,
          "info"
        )
      } else if (ok) {
        // Who's ahead is what the host quotes at the stand, not the raw #.
        // The server counts it, so another tablet's walk-ins aren't missed.
        const ahead: number = typeof data.ahead === "number" ? data.ahead : waiting.length
        addToast(
          `Added ${walkInName.trim()} at #${isRestaurant ? ahead + 1 : data.position} -- ${ahead === 0 ? "next up" : `${ahead} ${isRestaurant ? (ahead === 1 ? "party" : "parties") : ahead === 1 ? "person" : "people"} ahead`}`,
          "success"
        )
        // Walk-ins come in groups: keep the form open for the next one
        setWalkInName("")
        setWalkInNote("")
        setWalkInSize(2)
        walkInNameRef.current?.focus()
      } else {
        addToast(data.error || "Failed to add the walk-in", "error")
      }
      await onChanged()
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

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/lines/${lineId}`)
      setCopied(true)
      setCopyAnnounce("Link copied to clipboard")
      setTimeout(() => {
        setCopied(false)
        setCopyAnnounce("")
      }, 2000)
    } catch {
      addToast("Couldn't copy -- select the link and copy it yourself", "error")
    }
  }

  const hasEarnings = !!earnings && (earnings.earned > 0 || earnings.pending > 0)
  // Restaurant holds need the settlement page even when the owner takes no fee
  const showMoney = ownerFeePercent > 0 || hasEarnings || allowResale
  // At 0% there is nothing to pay out unless a fee was earned before a change
  const needsPayoutSetup = stripeEnabled && !hasPayoutSetup && showMoney && (ownerFeePercent > 0 || hasEarnings)

  return (
    <div className="mb-6 bg-white border border-ink" data-testid="owner-console">
      <ConfirmModal
        open={showClearConfirm}
        title={`Clear ${servedWord} ${isRestaurant ? "parties" : "people"}`}
        message={`Remove the ${served.length} ${isRestaurant ? (served.length === 1 ? "party" : "parties") : served.length === 1 ? "person" : "people"} you've already ${servedWord} from the line? ${isRestaurant ? "No one's place in line changes." : "Everyone still waiting moves up."} Their payments stay final.${!isRestaurant && roomLeft != null ? " Served people still count toward your capacity (it tracks stock handed out), so this won't let more people join -- raise the capacity in Edit to add stock." : ""}`}
        confirmLabel={isRestaurant ? "Clear Seated" : "Clear Served"}
        isLoading={busy === "clear"}
        onConfirm={handleClearServed}
        onCancel={() => setShowClearConfirm(false)}
      />
      <ConfirmModal
        open={seatUncalledConfirm && !!upNext}
        title={isRestaurant ? "Seat without calling?" : "Mark as served?"}
        message={`${isRestaurant ? "Seat" : "Mark"} ${upNext?.user.name || (isRestaurant ? "this party" : "this person")}${isRestaurant && upNext ? ` (party of ${upNext.partySize ?? 1})` : ""}${isRestaurant ? "" : " as served"}? They haven't been called yet.${heldPayments ? " Any swap payment of theirs on hold is collected now." : ""} This can't be undone.`}
        confirmLabel={markServedLabel}
        isLoading={busy === "serve"}
        onConfirm={() => {
          setSeatUncalledConfirm(false)
          handleServe(false)
        }}
        onCancel={() => setSeatUncalledConfirm(false)}
      />
      <ConfirmModal
        open={!!noShowTarget}
        title="Mark as a no-show?"
        message={`Remove ${noShowTarget?.user.name || (isRestaurant ? "this party" : "this person")}${isRestaurant && noShowTarget ? ` (party of ${noShowTarget.partySize ?? 1})` : ""} from the line as a no-show? Everyone behind them moves up.${heldPayments ? " Any swap payment of theirs on hold is collected." : ""}`}
        confirmLabel="No-show"
        variant="danger"
        isLoading={!!noShowTarget && busy?.startsWith("no-show") === true}
        onConfirm={handleNoShow}
        onCancel={() => setNoShowTarget(null)}
      />

      {closeChoice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div
            ref={closeDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-line-title"
            aria-describedby="close-line-desc"
            className="bg-white border border-ink max-w-md w-full p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
          >
            <h3 id="close-line-title" className="text-lg font-semibold tracking-tight text-ink mb-2">
              {isRestaurant ? "Close for the night?" : "Close the line?"}
            </h3>
            <p id="close-line-desc" className="text-sm text-ink/60 mb-4">
              This pauses the line so no one new can join, and clears the list
              {waiting.length > 0 && (
                <>
                  , removing the {waiting.length}{" "}
                  {isRestaurant
                    ? waiting.length === 1 ? "party" : "parties"
                    : waiting.length === 1 ? "person" : "people"}{" "}
                  still waiting
                </>
              )}
              .{waiting.length > 0 && " Everyone still waiting is told they're no longer in line."}
              {hasAnnouncement && " Your announcement is cleared too."}
              {" "}Export CSV from the ⋯ menu first if you want a copy of the list.
              {heldPayments && " Choose what happens to swap payments still on hold:"}
            </p>
            <div className="flex flex-col space-y-2">
              <Button onClick={() => handleClose("payout")} isLoading={busy === "close"} className="w-full">
                {heldPayments ? "Close and keep payments" : "Close the line"}
              </Button>
              {heldPayments && (
                <Button variant="danger" onClick={() => handleClose("refund")} isLoading={busy === "close"} className="w-full">
                  Close and refund held payments
                </Button>
              )}
              <Button variant="ghost" onClick={() => setCloseChoice(false)} className="w-full" data-autofocus>
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
              <p className="font-semibold text-ink">
                {notYetOpen && opensAt
                  ? `Your line opens ${formatDateTime(opensAt, { withZone: true })}. Share the link now -- people can ask to be emailed when it opens.`
                  : "Your line is live. Share the link so people can join."}
              </p>
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
                {/* A focused button's text change isn't reliably read out */}
                <p className="sr-only" aria-live="polite">{copyAnnounce}</p>
              </div>
              <p className="text-xs text-ink/60 mt-1.5">
                Use Share above for a printable QR code or a website embed.
              </p>
            </div>
            {onDismissCreated && (
              <button
                onClick={onDismissCreated}
                className="text-ink/60 hover:text-ink flex-shrink-0 p-2.5 -m-2.5 inline-flex"
                aria-label="Dismiss"
              >
                <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest ${isActive && !notYetOpen && !closedBySchedule ? "text-green-700" : "text-amber-700"}`}>
            <span className={`w-1.5 h-1.5 ${isActive && !notYetOpen && !closedBySchedule ? "bg-green-600" : "bg-amber-500"}`} aria-hidden />
            {!isActive ? "Paused" : closedBySchedule ? "Past closing time" : notYetOpen && opensAt ? `Opens ${formatDateTime(opensAt, { withZone: true })}` : "Open"}
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
              ? !isActive
                ? "No one in line, and the line is paused -- tap Resume so people can join online."
                : closedBySchedule
                  ? "No one in line, and it's past closing time -- change the closing time in Edit to take more guests."
                  : "No one in line yet. Share the link to get people in."
              : `Everyone in line has been ${servedWord}.`}
          </p>
        ) : (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="font-mono text-xs uppercase tracking-widest text-ink/60">
                {isServingUpNext ? "Now serving" : "Up next"}
              </p>
              <p className="text-lg font-semibold tracking-tight truncate">
                <span className="font-mono tabular-nums text-accent mr-2">#{placeOf(upNext)}</span>
                {upNext.user.name || "Anonymous"}
              </p>
              {/* What the host needs to match a table: size, how long they've waited, requests */}
              {(isRestaurant || upNext.joinedAt) && (
                <p className="text-xs text-ink/60 break-words">
                  {[
                    isRestaurant && `Party of ${upNext.partySize ?? 1}`,
                    upNext.user.isWalkIn && "Walk-in",
                    upNext.joinedAt && `waiting ${formatWaited(Math.max(0, Math.floor((clock - new Date(upNext.joinedAt).getTime()) / 60_000)))}`,
                    isRestaurant && upNext.note,
                  ].filter(Boolean).join(" · ")}
                </p>
              )}
              {isServingUpNext && upNext.response && (
                <p className={`text-xs ${upNext.response === "ON_MY_WAY" ? "text-green-700" : "text-amber-700"}`}>
                  {upNext.response === "ON_MY_WAY" ? "Says they're on the way" : "Says they're running late"}
                </p>
              )}
              {(() => {
                const ago = calledAgo(upNext)
                if (!ago) return null
                const left = showUpTimeLeft(upNext)
                // Capitalised on its own; walk-ins and no-limit lines show just this
                const agoText = ago.charAt(0).toUpperCase() + ago.slice(1)
                return (
                  <p className="text-xs text-ink/60">
                    {agoText}
                    {timerOnHold(upNext) && " · timer on hold while paused"}
                    {left && (
                      <>
                        {" · "}{left} left to show up{" "}
                        <button
                          onClick={() => handleGiveMoreTime(upNext)}
                          disabled={!!busy}
                          aria-label={`Give ${upNext.user.name || (isRestaurant ? "this party" : "this person")} 5 more minutes`}
                          className="inline-flex items-center min-h-11 px-2 -my-3 pointer-fine:min-h-0 pointer-fine:px-0 pointer-fine:my-0 font-mono uppercase tracking-widest text-accent hover:underline underline-offset-4 disabled:opacity-50"
                        >
                          +5 min
                        </button>
                      </>
                    )}
                  </p>
                )
              })()}
              {purchaseLimit && (
                <p className="text-xs text-ink/60">Limit {purchaseLimit} per person</p>
              )}
              {upNextLocked && (
                <p className="text-xs text-amber-700">A swap for this spot is in progress. {isRestaurant ? "Seating" : "Serving"} or calling them now cancels it (the buyer isn&apos;t charged).</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isServingUpNext ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => handleServe(canCallAfterNext)}
                    isLoading={busy === (canCallAfterNext ? "serve-next" : "serve")}
                    disabled={!!busy}
                  >
                    {!canCallAfterNext
                      ? markServedLabel
                      : isRestaurant
                        ? `Seated · Call ${afterNext.user.name || "Next"} (${afterNext.partySize ?? 1})`
                        : "Done · Call Next"}
                  </Button>
                  {canCallAfterNext && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleServe(false)}
                      isLoading={busy === "serve"}
                      disabled={!!busy}
                    >
                      {markServedLabel}
                    </Button>
                  )}
                  {upNext.calledAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setNoShowTarget(upNext)}
                      isLoading={busy === "no-show"}
                      disabled={!!busy}
                    >
                      No-show
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
                    // A walk-in is already standing at the stand: no call to skip
                    onClick={() => (upNext.user.isWalkIn ? handleServe(false) : setSeatUncalledConfirm(true))}
                    isLoading={busy === "serve"}
                    disabled={!!busy}
                  >
                    {markServedLabel}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {alsoCalled.length > 0 && (
          <ul className="mt-3 border-t border-rule pt-3 space-y-2" aria-label="Also called">
            {alsoCalled.map((p) => {
              const name = p.user.name || "Anonymous"
              const left = showUpTimeLeft(p)
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 flex-wrap text-sm">
                  <p className="min-w-0 text-ink/80">
                    <span className="font-mono text-xs uppercase tracking-widest text-ink/60 mr-2">Also called:</span>
                    <span className="font-mono tabular-nums text-accent mr-1">#{placeOf(p)}</span>
                    {name}
                    {isRestaurant && ` (party of ${p.partySize ?? 1})`}
                    {p.response && (
                      <span className={p.response === "ON_MY_WAY" ? "text-green-700" : "text-amber-700"}>
                        {" · "}{p.response === "ON_MY_WAY" ? "on the way" : "running late"}
                      </span>
                    )}
                    <span className="text-ink/60">
                      {" · "}{calledAgo(p)}
                      {left && <>{" · "}{left} left</>}
                      {timerOnHold(p) && " · timer on hold"}
                      {isRestaurant && p.note && <>{" · "}{p.note}</>}
                    </span>
                    {left && (
                      <>
                        {" "}
                        <button
                          onClick={() => handleGiveMoreTime(p)}
                          disabled={!!busy}
                          aria-label={`Give ${name} 5 more minutes`}
                          className="inline-flex items-center min-h-11 px-2 -my-3 pointer-fine:min-h-0 pointer-fine:px-0 pointer-fine:my-0 font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4 disabled:opacity-50"
                        >
                          +5 min
                        </button>
                      </>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleSeatAlsoCalled(p)}
                      isLoading={busy === `seat-${p.id}`}
                      disabled={!!busy}
                      aria-label={`${markServedLabel}: ${name}`}
                    >
                      {markServedLabel}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setNoShowTarget(p)}
                      isLoading={busy === `no-show-${p.id}`}
                      disabled={!!busy}
                      aria-label={`No-show: ${name}`}
                    >
                      No-show
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
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
                {pace.medianWaitMinutes !== null && <>, typical wait lately {formatWaited(Math.round(pace.medianWaitMinutes))}</>}
              </span>
            )}
          </p>
        ) : null}

        {walkInOpen ? (
          <form onSubmit={handleAddWalkIn} className="mt-3 flex flex-wrap items-end gap-2 border border-rule p-3">
            <label className="flex flex-col text-xs text-ink/60">
              Name
              <input
                ref={walkInNameRef}
                autoFocus
                autoComplete="off"
                enterKeyHint="done"
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                maxLength={50}
                required
                className="mt-1 border border-rule bg-white px-2 py-1.5 min-h-11 pointer-fine:min-h-0 text-base sm:text-sm text-ink focus:outline-none focus:border-ink"
              />
            </label>
            {isRestaurant && (
              <>
                <label className="flex flex-col text-xs text-ink/60">
                  Party of
                  <select
                    value={walkInParty}
                    onChange={(e) => setWalkInSize(Number(e.target.value))}
                    className="mt-1 border border-rule bg-white px-2 py-1.5 min-h-11 pointer-fine:min-h-0 text-base sm:text-sm text-ink"
                  >
                    {/* Only sizes that fit, so a 6-top isn't refused after typing the name */}
                    {Array.from({ length: walkInMax }, (_, i) => i + 1).map((n) => (
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
                    className="mt-1 border border-rule bg-white px-2 py-1.5 min-h-11 pointer-fine:min-h-0 text-base sm:text-sm text-ink placeholder:text-ink/60 focus:outline-none focus:border-ink"
                  />
                </label>
              </>
            )}
            <Button size="sm" type="submit" isLoading={busy === "walk-in"} disabled={!walkInName.trim() || roomLeft === 0}>
              Add to line
            </Button>
            {roomLeft === 0 && (
              <p className="w-full text-xs text-accent" role="status">The line is full. Seat or remove someone to make room.</p>
            )}
            {/* The party-size list quietly stopped at the room left, with no reason given */}
            {isRestaurant && roomLeft != null && roomLeft > 0 && roomLeft < MAX_PARTY_SIZE && (
              <p className="w-full text-xs text-ink/70">Room for {roomLeft} more {roomLeft === 1 ? "guest" : "guests"} under your cap.</p>
            )}
            <Button size="sm" variant="ghost" type="button" onClick={() => setWalkInOpen(false)}>
              Done
            </Button>
          </form>
        ) : (
          <button
            ref={walkInButtonRef}
            onClick={() => setWalkInOpen(true)}
            className="mt-3 inline-flex items-center min-h-11 pointer-fine:min-h-0 font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
          >
            + Add walk-in
          </button>
        )}

        <div className="mt-3 flex items-center gap-3 font-mono text-xs uppercase tracking-widest text-ink/60 tabular-nums">
          <span>{waiting.length} waiting</span>
          <span className="text-ink/20">·</span>
          <span>{served.length} {servedWord}</span>
          {served.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={!!busy}
              className="inline-flex items-center min-h-11 pointer-fine:min-h-0 text-accent hover:underline underline-offset-4 disabled:opacity-50"
            >
              Clear {servedWord}
            </button>
          )}
          <Link
            href={`/lines/${lineId}/analytics`}
            className="ml-auto inline-flex items-center min-h-11 pointer-fine:min-h-0 text-accent hover:underline underline-offset-4"
          >
            Analytics &rarr;
          </Link>
        </div>
      </div>

      {showMoney && (
        <div className="px-4 py-3 border-t border-rule flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-ink/60">
              {ownerFeePercent > 0 ? `Your fees (${ownerFeePercent}% per swap)` : "Paid swaps"}
            </p>
            <p className="font-mono tabular-nums text-green-700">
              {ownerFeePercent === 0 && !hasEarnings
                ? `${earnings?.swaps ?? 0} paid ${(earnings?.swaps ?? 0) === 1 ? "swap" : "swaps"} · no fee`
                : `${formatCurrency(earnings?.earned ?? 0)} earned`}
              {(earnings?.pending ?? 0) > 0 && (
                <span className="text-amber-700"> + {formatCurrency(earnings?.pending ?? 0)} pending</span>
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
              className="inline-flex items-center min-h-11 pointer-fine:min-h-0 font-mono text-xs uppercase tracking-widest text-accent hover:underline underline-offset-4"
            >
              Settlement &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
