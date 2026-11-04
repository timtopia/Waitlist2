import { afterEach, describe, expect, it, vi } from "vitest"
import { batchRemove, BATCH_REMOVE_CHUNK } from "@/lib/batch-remove-client"

function reply(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)
}

describe("batchRemove", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("sends a long line in chunks and adds up the totals", async () => {
    const ids = Array.from({ length: BATCH_REMOVE_CHUNK * 2 + 3 }, (_, i) => `p${i}`)
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const n = JSON.parse(String(init?.body)).positionIds.length
      return reply({ removed: n - 1, failed: 0, alreadyGone: 1, refundedCount: 1, refundedAmount: 2.5, refundFailedCount: 0, collectFailedCount: 0 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { ok, data } = await batchRemove("line1", ids, { action: "payout", reason: "closed" })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ action: "payout", reason: "closed" })
    expect(ok).toBe(true)
    expect(data).toMatchObject({ removed: ids.length - 3, alreadyGone: 3, refundedCount: 3, refundedAmount: 7.5 })
  })

  it("reports a first-chunk refusal as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ error: "Only the line's organizer can do that." }, false)))
    const { ok, data } = await batchRemove("line1", ["a", "b"], { action: "payout" })
    expect(ok).toBe(false)
    expect(data.error).toBe("Only the line's organizer can do that.")
  })

  it("counts what's left as not removed when a later chunk fails", async () => {
    const ids = Array.from({ length: BATCH_REMOVE_CHUNK + 10 }, (_, i) => `p${i}`)
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => reply({ removed: BATCH_REMOVE_CHUNK, failed: 0 }))
      .mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")))
    vi.stubGlobal("fetch", fetchMock)

    const { ok, data } = await batchRemove("line1", ids, { action: "refund" })
    expect(ok).toBe(true)
    expect(data.removed).toBe(BATCH_REMOVE_CHUNK)
    expect(data.failed).toBe(10)
  })
})
