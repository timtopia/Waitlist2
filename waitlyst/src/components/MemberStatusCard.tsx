"use client"

import { useEffect, useState } from "react"
import { callDeadline, timeLeft } from "@/lib/call-deadline"
import { Button } from "./ui/Button"
import { Card } from "@/components/ui/Card"
import { formatCurrency } from "@/lib/format"
import { formatWaitTime } from "@/lib/wait-time"
import type { MemberStatus } from "@/lib/member-status"

export type NotificationState = "unsupported" | "default" | "denied" | "granted"

interface MemberStatusCardProps {
  status: MemberStatus
  maxCapacity: number | null
  totalPositions: number
  /** Capacity used as the server counts it: served-and-cleared people still
   * take up spots, so "spots left" can't be worked out from the list alone */
  capacityUsed?: number
  askingPrice: number | null
  lineId: string
  hideCapacity?: boolean
  isPaused?: boolean
  calledAt?: string | null
  /** The host's own estimate for this party, and when they gave it */
  quotedMinutes?: number | null
  quotedAt?: string | null
  /** What they told the host after being called */
  response?: "ON_MY_WAY" | "RUNNING_LATE" | null
  respondedAt?: string | null
  /** Extra minutes the host gave them to show up */
  graceMinutes?: number
  /** Minutes a called person has to show up before being skipped */
  responseWindowMinutes?: number | null
  /** "N per person" on a drop */
  purchaseLimit?: number | null
  onRespond?: (response: "ON_MY_WAY" | "RUNNING_LATE") => Promise<void>
  notificationPermission?: NotificationState
  onEnableNotifications?: () => void
  /** The line emails "you're next" / "you're called" */
  emailEnabled?: boolean
  /** Restaurant lines count parties ahead, not people */
  isRestaurant?: boolean
  /** Whether spots on this line can be listed for swap at all */
  allowResale?: boolean
}

export function MemberStatusCard({
  status,
  maxCapacity,
  totalPositions,
  capacityUsed,
  askingPrice,
  lineId,
  hideCapacity = false,
  isPaused = false,
  calledAt = null,
  quotedMinutes = null,
  quotedAt = null,
  response = null,
  respondedAt = null,
  graceMinutes = 0,
  responseWindowMinutes = null,
  purchaseLimit = null,
  onRespond,
  notificationPermission = "unsupported",
  onEnableNotifications,
  emailEnabled = false,
  isRestaurant = false,
  allowResale = true,
}: MemberStatusCardProps) {
  const { phase, position, ahead } = status
  const [minutesPerPerson, setMinutesPerPerson] = useState<number | null>(null)
  const [waitTimeLoading, setWaitTimeLoading] = useState(true)
  // A failed request (rate limit on shared Wi-Fi, server error) isn't "no one
  // has been seated yet"
  const [waitTimeFailed, setWaitTimeFailed] = useState(false)
  const [responding, setResponding] = useState<string | null>(null)
  // Tick once a second while called, for the countdown
  const [now, setNow] = useState(() => Date.now())
  const deadline = phase === "called" && !isPaused ? callDeadline(calledAt, responseWindowMinutes, respondedAt, graceMinutes) : null
  const deadlineMs = deadline?.getTime() ?? null
  useEffect(() => {
    if (deadlineMs === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [deadlineMs])
  // Slower tick so the host's quoted time can flip to "has passed"
  useEffect(() => {
    if (deadlineMs !== null || !quotedAt) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [deadlineMs, quotedAt])
  const left = timeLeft(deadline, now)
  // When the number ahead last changed: the estimate's clock time counts
  // from here (adjusting state during render, per React's guidance)
  const [aheadSince, setAheadSince] = useState(() => ({ ahead, at: Date.now() }))
  if (aheadSince.ahead !== ahead) setAheadSince({ ahead, at: Date.now() })

  // Refetch as the line moves: each service event changes the pace estimate.
  useEffect(() => {
    if (phase !== "waiting") return
    let cancelled = false
    fetch(`/api/lines/${lineId}/wait-time`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        setWaitTimeFailed(false)
        setMinutesPerPerson(data?.estimatedMinutesPerPerson ?? null)
      })
      .catch(() => {
        if (!cancelled) setWaitTimeFailed(true)
      })
      .finally(() => {
        if (!cancelled) setWaitTimeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [lineId, ahead, phase])

  const pastCapacity = maxCapacity !== null && position > maxCapacity
  const spotsLeft = maxCapacity !== null ? Math.max(maxCapacity - (capacityUsed ?? totalPositions), 0) : 0
  let capacityLabel: string | null = null
  let capacityColor = "text-ink"
  let capacityDot = "bg-green-600"
  if (maxCapacity !== null) {
    if (pastCapacity) {
      capacityLabel = "You're on the waitlist"
      capacityColor = "text-amber-700"
      capacityDot = "bg-amber-600"
    } else {
      capacityLabel = "Your spot is secured"
      capacityColor = "text-green-700"
    }
  }

  // The host's word beats the app's estimate. Show it as a clock time so
  // guests don't have to do the maths, and say so once it has passed.
  let quoteDetail: string | null = null
  if (quotedMinutes && quotedAt) {
    const readyBy = new Date(new Date(quotedAt).getTime() + quotedMinutes * 60_000)
    const at = readyBy.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    quoteDetail = now > readyBy.getTime()
      ? `The host's estimate (${at}) has passed. You're still in line.`
      : `The host expects to seat you around ${at}.`
  }

  const organizer = isRestaurant ? "host" : "organizer"
  let headline: string
  let detail: string
  if (phase === "called") {
    headline = "It's your turn"
    // No "just now"/"5 min ago": resuming a pause moves calledAt forward so the
    // show-up clock picks up where it stopped, which made an old call read as
    // a fresh one. The countdown below says how long they have.
    detail = isRestaurant
      ? "The host called you. Head to the host stand."
      : "The organizer called you. It's your turn now."
  } else if (phase === "served") {
    headline = isRestaurant ? "You've been seated" : "You've been served"
    detail = isRestaurant ? "Enjoy your meal." : "You're all set. Leave the line whenever you're ready."
  } else if (phase === "next") {
    headline = "You're next"
    // Everyone still ahead has been called (they're at the stand), which is
    // when the "you're next" email goes out
    const calledAhead = ahead === 1
      ? `The ${isRestaurant ? "party" : "person"} ahead of you has been called.`
      : `The ${ahead} ${isRestaurant ? "parties" : "people"} ahead of you have been called.`
    // A paused drop calls no one; a restaurant host can still call while paused
    detail = isPaused && !isRestaurant && ahead === 0
      ? "You're first in line. The organizer paused the line, so you'll be called once it resumes."
      : quoteDetail ?? (ahead > 0
        ? `${calledAhead} Stay close; you're up next.`
        : "No one is ahead of you. Stay close; you'll be called soon.")
  } else {
    headline = isRestaurant
      ? `${ahead} ${ahead === 1 ? "party" : "parties"} ahead of you`
      : `${ahead} ${ahead === 1 ? "person" : "people"} ahead of you`
    // A paused line isn't moving: a clock time would bring them back too early
    if (isPaused) detail = `Line paused. No wait estimate until the ${organizer} resumes it.`
    else if (quoteDetail) detail = quoteDetail
    else if (waitTimeLoading) detail = "Estimating your wait..."
    else if (minutesPerPerson != null) {
      // A clock time, like the host's quote: someone stepping away for a
      // drink needs to know when to be back, not do the maths. Counted from
      // when the line last moved, not from each poll -- otherwise a big
      // party watching smaller ones get seated around them sees "around
      // 7:40" quietly drift to 8:05 while the estimate never changes.
      const minutes = minutesPerPerson * ahead
      const aroundMs = aheadSince.at + minutes * 60_000
      const around = new Date(aroundMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      detail = minutes >= 1 && Date.now() > aroundMs + 5 * 60_000
        ? `Taking longer than estimated (we guessed around ${around}). You're still in line.`
        : `Est. wait: ${formatWaitTime(minutes)}${minutes >= 1 ? ` (around ${around})` : ""}`
    } else if (waitTimeFailed) detail = "Wait estimate unavailable right now. You're still in line."
    else detail = `Wait estimate appears after the ${organizer} has ${isRestaurant ? "seated" : "served"} a couple of ${isRestaurant ? "parties" : "people"}.`
  }

  const accent = phase === "called"
  const done = phase === "served"
  // Seated parties stay listed until cleared, so on a restaurant line the
  // spot number overcounts; show the place among parties still waiting.
  const place = isRestaurant && !done ? ahead + 1 : position

  return (
    <Card
      className={`mb-6 border-l-2 overflow-hidden ${
        accent ? "border-l-accent border-accent" : done ? "border-l-green-700" : "border-l-accent"
      }`}
    >
      <div className="px-5 py-4 sm:px-6">
        <div className="flex items-center gap-4 sm:gap-6">
          <div
            // Grows past 64px for big drops (#10000) instead of spilling out
            className={`flex-shrink-0 min-w-16 h-16 px-1 sm:min-w-20 sm:h-20 flex flex-col items-center justify-center ${
              accent ? "bg-accent text-paper" : done ? "bg-green-700 text-paper" : "bg-ink text-paper"
            }`}
          >
            {done ? (
              // Seated parties stay listed, so the raw spot number would look
              // like they'd moved back at the moment they sat down
              <span className="text-3xl sm:text-4xl leading-none" role="img" aria-label={isRestaurant ? "Seated" : "Served"}>✓</span>
            ) : (
              <>
                <span className="font-mono text-xs uppercase tracking-widest opacity-60 leading-none">#</span>
                <span className="font-mono tabular-nums text-2xl sm:text-3xl leading-none mt-1">{place}</span>
              </>
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-1.5">
            <p className="font-mono text-xs uppercase tracking-widest text-ink/60">Your place</p>
            {/* Only the headline is live: announcing the whole card re-read
                every button and countdown whenever anything changed */}
            <p
              id="my-status-headline"
              role="status"
              tabIndex={-1}
              className={`text-xl font-semibold tracking-tight focus:outline-none ${accent ? "text-accent" : "text-ink"}`}
            >
              {headline}
            </p>
            <p className="text-sm text-ink/60">{detail}</p>
            {!done && (
              <a
                href="#my-spot"
                onClick={() => requestAnimationFrame(() => document.getElementById("my-spot")?.focus({ preventScroll: true }))}
                className="inline-flex items-center min-h-11 pointer-fine:min-h-0 text-sm text-accent underline underline-offset-2"
              >
                {isRestaurant
                  ? phase === "called"
                    // Party size is locked once called; the host handles it in person
                    ? "Party size changed? Tell the host at the stand. Add a note or leave."
                    : "Change party size, add a note, or leave"
                  : "Manage your spot or leave"}
              </a>
            )}
          </div>
        </div>

        {!done && (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink/60">
            {capacityLabel && (
              <span className={`inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest ${capacityColor}`}>
                <span className={`w-1.5 h-1.5 flex-shrink-0 ${capacityDot}`} aria-hidden />
                {capacityLabel}
              </span>
            )}
            {(allowResale || askingPrice !== null) && (
              <span>
                {askingPrice !== null
                  ? `Your spot is listed for ${formatCurrency(askingPrice)}`
                  : "Your spot isn't listed for swap"}
              </span>
            )}
          </div>
        )}

        {/* Always mounted, and only changes at a threshold, so a screen
            reader hears the warning and the expiry without the ticking */}
        <p className="sr-only" aria-live="assertive">
          {phase === "called" && deadline
            ? !left
              ? "Your time to show up has run out."
              : left === "under a minute"
                ? "Under a minute left to show up."
                : ""
            : ""}
        </p>

        {phase === "called" && (
          <div className="mt-4 space-y-2">
            {left ? (
              <p className="text-sm font-medium text-accent">
                Show up within {left}, or your place goes to the next {isRestaurant ? "party" : "person"}.
              </p>
            ) : deadline && (
              // The countdown used to just vanish at zero, leaving a late
              // guest unsure whether they still had a place
              <p className="text-sm font-medium text-accent">
                {isRestaurant
                  ? "Your time to show up has run out, so you'll be skipped in a moment. If you're already at the stand, tell the host -- they can add you back."
                  : "Your time to show up has run out, so you'll be skipped in a moment."}
              </p>
            )}
            {purchaseLimit && (
              <p className="text-sm text-ink/70">Limit: {purchaseLimit} per person.</p>
            )}
            {onRespond && (left || !deadline) && (
              <div className="flex flex-wrap items-center gap-2">
                {(["ON_MY_WAY", "RUNNING_LATE"] as const).map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={response === r ? "primary" : "secondary"}
                    aria-pressed={response === r}
                    isLoading={responding === r}
                    // One answer at a time: a second tap mid-request could land out of order
                    disabled={responding !== null}
                    onClick={async () => {
                      setResponding(r)
                      try {
                        await onRespond(r)
                      } finally {
                        setResponding(null)
                      }
                    }}
                  >
                    {r === "ON_MY_WAY" ? "On my way" : "Running late"}
                    {response === r && <span aria-hidden> ✓</span>}
                  </Button>
                ))}
                {response && (
                  <span className="text-xs text-ink/60">
                    {response === "RUNNING_LATE" && responseWindowMinutes
                      ? respondedAt
                        // "On my way" only extends a call once: don't promise more
                        ? `The ${organizer} can see this, but your time is still running and you've already had your extra time. Ask the ${organizer} if you need longer.`
                        : `The ${organizer} can see this, but your time is still running. Tap On my way when you head over to get more time.`
                      // The window restarts from the tap: answering at once adds next to nothing
                      : `The ${organizer} can see this${
                          response === "ON_MY_WAY" && responseWindowMinutes && respondedAt && calledAt &&
                          new Date(respondedAt).getTime() - new Date(calledAt).getTime() >= 60_000
                            ? ", and you have a little more time"
                            : ""
                        }.`}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {isPaused && !done && (
          <p className="mt-3 text-sm text-amber-700">
            {phase === "called"
              // "The host may still call you" read oddly to someone already called
              ? `The line is paused, so your time to show up is on hold. ${isRestaurant ? "Head to the host stand when you can." : "Go when you can."}`
              : isRestaurant
              ? "The line is paused. You keep your place, and the host may still call you."
              : "The line is paused. You keep your place while it's paused."}
          </p>
        )}

        {/* Most phones have no browser alerts; say how they'll hear instead */}
        {!done && notificationPermission === "unsupported" && (
          <p className="mt-4 pt-3 border-t border-rule text-xs text-ink/60">
            {emailEnabled
              ? "We'll email you when you're next and when you're called. This page also updates on its own."
              : "Keep this page open -- it updates on its own when your turn comes."}
          </p>
        )}

        {!done && notificationPermission !== "unsupported" && (
          <div className="mt-4 pt-3 border-t border-rule flex items-center justify-between gap-3">
            {notificationPermission === "granted" ? (
              <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-green-700">
                <span className="w-1.5 h-1.5 bg-green-600" aria-hidden />
                Alerts on. Keep this tab open.
              </span>
            ) : notificationPermission === "denied" ? (
              <span className="text-xs text-ink/60">
                Notifications are blocked for this site. Allow them in your browser settings to get alerted when it&apos;s your turn.
              </span>
            ) : (
              <>
                <span className="text-xs text-ink/60">Get an alert when it&apos;s your turn, even in another tab.</span>
                <button
                  onClick={onEnableNotifications}
                  className="flex-shrink-0 px-3 py-1.5 min-h-11 pointer-fine:min-h-0 font-mono text-xs uppercase tracking-widest border border-ink text-ink hover:bg-ink hover:text-paper transition-colors"
                >
                  Turn on alerts
                </button>
              </>
            )}
          </div>
        )}

        {maxCapacity !== null && !hideCapacity && !done && (
          <div className="mt-3 pt-3 border-t border-rule">
            <div className="flex items-center justify-between font-mono text-xs uppercase tracking-widest text-ink/60 tabular-nums">
              <span>Position {position} of {totalPositions} in line</span>
              <span>
                {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left
              </span>
            </div>
            <div className="mt-1.5 w-full bg-ink/10 h-1.5">
              <div
                className={`h-1.5 transition-all ${pastCapacity ? "bg-amber-600" : "bg-ink"}`}
                style={{ width: `${Math.min((position / maxCapacity) * 100, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
