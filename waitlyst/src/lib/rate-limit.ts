interface RateLimitConfig {
  /** Time window in milliseconds */
  interval: number
  /** Maximum requests allowed per window */
  limit: number
}

interface RateLimitResult {
  success: boolean
  remaining: number
  /** Timestamp (ms) when the current window resets */
  reset: number
}

/**
 * Simple in-memory sliding window rate limiter.
 *
 * Each call to `rateLimit()` returns a new limiter instance that tracks
 * request timestamps per key. The Map persists across requests within the
 * same serverless instance, giving basic per-instance protection against
 * abuse. On Vercel, instances are ephemeral, so this is not a global rate
 * limit — but it catches the most common abuse patterns (rapid-fire bots,
 * polling storms, etc.) without needing Redis or any external dependency.
 *
 * Expired entries are cleaned up every 60 seconds to avoid memory leaks.
 */
export function rateLimit(config: RateLimitConfig): {
  check: (key: string) => RateLimitResult
} {
  const { interval, limit } = config

  // Map from key -> array of request timestamps (ms)
  const requests = new Map<string, number[]>()

  // Periodic cleanup of expired entries to prevent memory leaks
  const CLEANUP_INTERVAL_MS = 60_000
  let lastCleanup = Date.now()

  function cleanup(now: number) {
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
    lastCleanup = now

    for (const [key, timestamps] of requests) {
      const valid = timestamps.filter((t) => now - t < interval)
      if (valid.length === 0) {
        requests.delete(key)
      } else {
        requests.set(key, valid)
      }
    }
  }

  function check(key: string): RateLimitResult {
    const now = Date.now()
    cleanup(now)

    const windowStart = now - interval
    const timestamps = requests.get(key) ?? []

    // Keep only timestamps within the current window
    const valid = timestamps.filter((t) => t > windowStart)

    if (valid.length >= limit) {
      // Rate limited — find when the oldest request in the window expires
      const oldestInWindow = valid[0]
      const reset = oldestInWindow + interval

      // Store the trimmed array back (no new timestamp added)
      requests.set(key, valid)

      return { success: false, remaining: 0, reset }
    }

    // Allow the request — record the timestamp
    valid.push(now)
    requests.set(key, valid)

    return {
      success: true,
      remaining: limit - valid.length,
      reset: now + interval,
    }
  }

  return { check }
}
