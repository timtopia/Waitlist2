import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useLineUpdates } from "@/hooks/useLineUpdates"

const fetchMock = vi.fn()
global.fetch = fetchMock

let visibility: "visible" | "hidden" = "visible"
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility })

function respondWith(body: string, etag: string | null = null) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(etag ? { ETag: etag } : {}),
    text: () => Promise.resolve(body),
  })
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

describe("useLineUpdates", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    visibility = "visible"
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("passes on the first poll, then only changes", async () => {
    const onUpdate = vi.fn()
    respondWith('{"v":1}')
    renderHook(() => useLineUpdates("line-1", onUpdate, { intervalMs: 1000 }))
    // Catches the page up on anything that changed since it first loaded
    await advance(2000)
    expect(onUpdate).toHaveBeenCalledWith({ type: "poll-update", data: { v: 1 } })
    onUpdate.mockClear()
    await advance(1000)
    expect(onUpdate).not.toHaveBeenCalled()
    respondWith('{"v":2}')
    await advance(1000)
    expect(onUpdate).toHaveBeenCalledWith({ type: "poll-update", data: { v: 2 } })
  })

  it("sends back the last ETag and treats 304 as unchanged", async () => {
    const onUpdate = vi.fn()
    respondWith('{"v":1}', '"e1"')
    renderHook(() => useLineUpdates("line-1", onUpdate, { intervalMs: 1000 }))
    await advance(2000)
    onUpdate.mockClear()
    fetchMock.mockResolvedValue({ ok: false, status: 304, headers: new Headers() })
    await advance(1000)
    expect(fetchMock.mock.calls.at(-1)?.[1].headers).toEqual({ "If-None-Match": '"e1"' })
    expect(onUpdate).not.toHaveBeenCalled()
    respondWith('{"v":2}', '"e2"')
    await advance(1000)
    expect(onUpdate).toHaveBeenCalledWith({ type: "poll-update", data: { v: 2 } })
  })

  it("skips polls while hidden by default", async () => {
    respondWith('{"v":1}')
    renderHook(() => useLineUpdates("line-1", vi.fn(), { intervalMs: 1000 }))
    await advance(2000)
    const callsBefore = fetchMock.mock.calls.length
    visibility = "hidden"
    document.dispatchEvent(new Event("visibilitychange"))
    await advance(5000)
    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it("keeps polling in the background when asked, so alerts can fire", async () => {
    const onUpdate = vi.fn()
    respondWith('{"v":1}')
    renderHook(() => useLineUpdates("line-1", onUpdate, { intervalMs: 1000, pollWhenHidden: true }))
    await advance(2000)
    visibility = "hidden"
    document.dispatchEvent(new Event("visibilitychange"))
    respondWith('{"v":2}')
    await advance(1000)
    expect(onUpdate).toHaveBeenCalledWith({ type: "poll-update", data: { v: 2 } })
  })

  it("reports stale on a server error, and recovers on the next good poll", async () => {
    const onUpdate = vi.fn()
    respondWith('{"v":1}')
    const { result } = renderHook(() => useLineUpdates("line-1", onUpdate, { intervalMs: 1000 }))
    await advance(2000)
    expect(result.current.stale).toBe(false)
    fetchMock.mockResolvedValue({ ok: false, status: 503, headers: new Headers() })
    await act(() => advance(1000))
    expect(result.current.stale).toBe(true)
    respondWith('{"v":1}')
    await act(() => advance(1000))
    expect(result.current.stale).toBe(false)
  })

  it("doesn't start a poll while one is still in flight", async () => {
    let resolve: (value: unknown) => void = () => {}
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r }))
    renderHook(() => useLineUpdates("line-1", vi.fn(), { intervalMs: 1000 }))
    await advance(2000)
    await advance(3000)
    window.dispatchEvent(new Event("online"))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolve({ ok: true, status: 200, headers: new Headers(), text: () => Promise.resolve("{}") })
    await advance(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
