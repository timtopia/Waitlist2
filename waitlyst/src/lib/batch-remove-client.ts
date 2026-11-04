/**
 * Batch removal from the browser, sent in chunks. One request for a whole
 * 300-person line worked through every removal (and its Stripe calls) in a
 * single function run: it could time out halfway, and past 500 the server
 * refused it outright. Chunks keep each request short and the totals add up
 * as if it were one call.
 */

export const BATCH_REMOVE_CHUNK = 50

export interface BatchRemoveTotals {
  removed: number
  failed: number
  alreadyGone: number
  refundedCount: number
  refundedAmount: number
  refundFailedCount: number
  collectFailedCount: number
  error?: string
}

const KEYS = [
  "removed",
  "failed",
  "alreadyGone",
  "refundedCount",
  "refundedAmount",
  "refundFailedCount",
  "collectFailedCount",
] as const

export async function batchRemove(
  lineId: string,
  positionIds: string[],
  body: { action: "payout" | "refund"; reason?: "closed" }
): Promise<{ ok: boolean; data: BatchRemoveTotals }> {
  const totals: BatchRemoveTotals = {
    removed: 0,
    failed: 0,
    alreadyGone: 0,
    refundedCount: 0,
    refundedAmount: 0,
    refundFailedCount: 0,
    collectFailedCount: 0,
  }
  for (let i = 0; i < positionIds.length; i += BATCH_REMOVE_CHUNK) {
    const chunk = positionIds.slice(i, i + BATCH_REMOVE_CHUNK)
    let res: Response | null = null
    let data: Record<string, unknown> = {}
    try {
      res = await fetch(`/api/lines/${lineId}/batch-remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionIds: chunk, ...body }),
      })
      data = await res.json().catch(() => ({}))
    } catch {
      res = null
    }
    if (!res || !res.ok) {
      const error =
        typeof data.error === "string" ? data.error : !res ? "No connection -- check your signal and try again" : undefined
      // Nothing went through: report it as the failure it is
      if (i === 0) return { ok: false, data: { ...totals, error } }
      // Part of the line is already cleared: say what's left, not "failed"
      totals.failed += positionIds.length - i
      totals.error = error
      return { ok: true, data: totals }
    }
    for (const key of KEYS) {
      const v = data[key]
      if (typeof v === "number") totals[key] += v
    }
  }
  return { ok: true, data: totals }
}
