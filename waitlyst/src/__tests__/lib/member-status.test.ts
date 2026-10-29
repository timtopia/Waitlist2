import { describe, it, expect } from "vitest"
import {
  getMemberStatus,
  getMemberPhase,
  diffMemberStatus,
  describeMemberEvent,
  memberTabTitle,
  StatusLine,
} from "@/lib/member-status"

function makeLine(
  people: { id: string; name?: string | null; fulfilled?: boolean }[],
  overrides: Partial<StatusLine> = {}
): StatusLine {
  return {
    isActive: true,
    nowServing: null,
    announcement: null,
    announcementAt: null,
    positions: people.map((p, i) => ({
      position: i + 1,
      fulfilled: p.fulfilled ?? false,
      user: { id: p.id, name: p.name === undefined ? p.id.toUpperCase() : p.name },
    })),
    ...overrides,
  }
}

describe("getMemberStatus", () => {
  it("returns null when the viewer isn't in the line or isn't signed in", () => {
    const line = makeLine([{ id: "a" }])
    expect(getMemberStatus(line, "zed")).toBeNull()
    expect(getMemberStatus(line, undefined)).toBeNull()
  })

  it("counts only unserved people ahead", () => {
    const line = makeLine([{ id: "a", fulfilled: true }, { id: "b" }, { id: "me" }])
    expect(getMemberStatus(line, "me")).toEqual({ phase: "waiting", position: 3, ahead: 1 })
  })

  it("treats someone behind only served people as next", () => {
    const line = makeLine([{ id: "a", fulfilled: true }, { id: "me" }])
    expect(getMemberStatus(line, "me")?.phase).toBe("next")
  })

  it("is 'called' when now-serving names the viewer and no one is ahead", () => {
    const line = makeLine([{ id: "me" }, { id: "b" }], { nowServing: "ME" })
    expect(getMemberStatus(line, "me")?.phase).toBe("called")
    // The person behind shares nothing with the called name
    expect(getMemberStatus(line, "b")?.phase).toBe("waiting")
  })

  it("isn't fooled by a now-serving name belonging to a served person ahead", () => {
    const line = makeLine([{ id: "a", fulfilled: true }, { id: "me" }], { nowServing: "A" })
    expect(getMemberStatus(line, "me")?.phase).toBe("next")
  })

  it("matches call-next's fallback name for users without one", () => {
    expect(getMemberPhase({ fulfilled: false, ahead: 0, nowServing: "Next person", userName: null })).toBe("called")
  })

  it("reports served once fulfilled, even at the front while called", () => {
    const line = makeLine([{ id: "me", fulfilled: true }], { nowServing: "ME" })
    expect(getMemberStatus(line, "me")?.phase).toBe("served")
  })
})

describe("diffMemberStatus", () => {
  it("ignores lines the viewer isn't in, including announcements", () => {
    const prev = makeLine([{ id: "a" }])
    const next = makeLine([{ id: "a" }, { id: "b" }], { announcement: "Hi", announcementAt: "t1" })
    expect(diffMemberStatus(prev, next, "me")).toEqual([])
  })

  it("reports moving up while still waiting", () => {
    const prev = makeLine([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "me" }])
    const next = makeLine([{ id: "b" }, { id: "c" }, { id: "me" }])
    expect(diffMemberStatus(prev, next, "me")).toEqual([{ kind: "moved", from: 4, to: 3 }])
  })

  it("reports reaching the front as 'next' rather than a move", () => {
    const prev = makeLine([{ id: "a" }, { id: "me" }])
    const next = makeLine([{ id: "me" }])
    expect(diffMemberStatus(prev, next, "me")).toEqual([{ kind: "next" }])
  })

  it("reports being called without a duplicate announcement event", () => {
    const prev = makeLine([{ id: "me" }, { id: "b" }])
    const next = makeLine([{ id: "me" }, { id: "b" }], {
      nowServing: "ME",
      announcement: "ME, you're up!",
      announcementAt: "t1",
    })
    expect(diffMemberStatus(prev, next, "me")).toEqual([{ kind: "called" }])
    // Everyone else still sees it as an announcement
    expect(diffMemberStatus(prev, next, "b")).toEqual([{ kind: "announcement", text: "ME, you're up!" }])
  })

  it("reports being served", () => {
    const prev = makeLine([{ id: "me" }], { nowServing: "ME" })
    const next = makeLine([{ id: "me", fulfilled: true }], { nowServing: "ME" })
    expect(diffMemberStatus(prev, next, "me")).toEqual([{ kind: "served" }])
  })

  it("distinguishes leaving after service from being removed while waiting", () => {
    const empty = makeLine([{ id: "b" }])
    expect(diffMemberStatus(makeLine([{ id: "me", fulfilled: true }, { id: "b" }]), empty, "me"))
      .toEqual([{ kind: "removed", wasServed: true }])
    expect(diffMemberStatus(makeLine([{ id: "me" }, { id: "b" }], { nowServing: "ME" }), empty, "me"))
      .toEqual([{ kind: "removed", wasServed: true }])
    expect(diffMemberStatus(makeLine([{ id: "b" }, { id: "me" }]), empty, "me"))
      .toEqual([{ kind: "removed", wasServed: false }])
  })

  it("reports pause and resume", () => {
    const active = makeLine([{ id: "a" }, { id: "me" }])
    const paused = makeLine([{ id: "a" }, { id: "me" }], { isActive: false })
    expect(diffMemberStatus(active, paused, "me")).toEqual([{ kind: "paused" }])
    expect(diffMemberStatus(paused, active, "me")).toEqual([{ kind: "resumed" }])
  })

  it("does not report a cleared announcement", () => {
    const prev = makeLine([{ id: "me" }, { id: "x" }], { announcement: "Old", announcementAt: "t1" })
    const next = makeLine([{ id: "me" }, { id: "x" }], { announcement: null, announcementAt: "t2" })
    expect(diffMemberStatus(prev, next, "x")).toEqual([])
  })
})

describe("describeMemberEvent", () => {
  it("toasts for the moments that need action", () => {
    expect(describeMemberEvent({ kind: "called" }, "Bakery")).toMatchObject({ title: "It's your turn!", toast: true })
    expect(describeMemberEvent({ kind: "removed", wasServed: false }, "Bakery")).toMatchObject({ toast: true, tone: "warning" })
  })

  it("only alerts on moves near the front", () => {
    expect(describeMemberEvent({ kind: "moved", from: 40, to: 39 }, "Bakery")).toBeNull()
    expect(describeMemberEvent({ kind: "moved", from: 4, to: 3 }, "Bakery")).toMatchObject({ title: "You're #3", toast: false })
  })
})

describe("memberTabTitle", () => {
  it("shows position, turn, or served state", () => {
    expect(memberTabTitle(null, "Bakery")).toBeNull()
    expect(memberTabTitle({ phase: "waiting", position: 4, ahead: 3 }, "Bakery")).toBe("#4 · Bakery")
    expect(memberTabTitle({ phase: "called", position: 1, ahead: 0 }, "Bakery")).toBe("Your turn! · Bakery")
    expect(memberTabTitle({ phase: "served", position: 1, ahead: 0 }, "Bakery")).toBe("Served · Bakery")
  })
})
