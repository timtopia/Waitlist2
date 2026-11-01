/**
 * Client-safe twin of responseDeadline in missed-calls.ts: when a called
 * person must show up by. Saying "on my way" buys one more window from when
 * they first said it (respondedAt), kept even if they're later running late.
 */
export function callDeadline(
  calledAt: string | null | undefined,
  windowMinutes: number | null | undefined,
  respondedAt: string | null | undefined,
  /** Extra time the host gave them */
  graceMinutes: number | null | undefined = 0
): Date | null {
  if (!calledAt || !windowMinutes) return null
  const windowMs = windowMinutes * 60_000
  let deadline = new Date(calledAt).getTime() + windowMs
  if (respondedAt) {
    deadline = Math.max(deadline, new Date(respondedAt).getTime() + windowMs)
  }
  return new Date(deadline + (graceMinutes ?? 0) * 60_000)
}

/** "4 min" / "under a minute" until the deadline, or null once it's passed */
export function timeLeft(deadline: Date | null, now = Date.now()): string | null {
  if (!deadline) return null
  const ms = deadline.getTime() - now
  if (ms <= 0) return null
  const minutes = Math.ceil(ms / 60_000)
  return minutes <= 1 ? "under a minute" : `${minutes} min`
}
