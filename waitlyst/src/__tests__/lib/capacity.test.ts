import { describe, it, expect } from "vitest"
import { capacityUsed, capacityView, roomLeftMessage } from "@/lib/capacity"

const line = { maxCapacity: 5, hideCapacity: false, createdById: "owner" }

describe("capacityView", () => {
  it("shows the limit when it isn't hidden", () => {
    expect(capacityView(line, 2)).toEqual({ maxCapacity: 5, hasCapacityLimit: true, isFull: false, capacityUsed: 2 })
  })

  it("reports full at the limit", () => {
    expect(capacityView(line, 5).isFull).toBe(true)
  })

  it("hides the limit from anyone but the owner", () => {
    const hidden = { ...line, hideCapacity: true }
    // The used count is hidden too: with "room for N more" it gave the limit away
    expect(capacityView(hidden, 5, "member")).toEqual({ maxCapacity: null, hasCapacityLimit: true, isFull: true, capacityUsed: 0 })
    expect(capacityView(hidden, 5)).toMatchObject({ maxCapacity: null })
    expect(capacityView(hidden, 5, "owner")).toMatchObject({ maxCapacity: 5 })
  })

  it("has no limit and is never full without a capacity", () => {
    expect(capacityView({ ...line, maxCapacity: null, hideCapacity: true }, 100)).toEqual({
      maxCapacity: null,
      hasCapacityLimit: false,
      isFull: false,
      capacityUsed: 100,
    })
  })
})

describe("capacityUsed", () => {
  it("counts only waiting guests on a restaurant line: a seated party has its table", () => {
    const positions = [
      { partySize: 4, fulfilled: true },
      { partySize: 2, fulfilled: false },
      { partySize: 3, fulfilled: false },
    ]
    expect(capacityUsed("RESTAURANT", positions)).toBe(5)
  })

  it("counts everyone admitted to a drop, including served people already cleared", () => {
    const positions = [{ fulfilled: true }, { fulfilled: false }]
    // Clearing the served must not reopen spots on a limited drop
    expect(capacityUsed("STANDARD", positions, 3)).toBe(5)
  })
})

describe("roomLeftMessage", () => {
  it("names the room left, unless the owner hides capacity", () => {
    expect(roomLeftMessage({ hideCapacity: false, kind: "RESTAURANT" }, 3)).toContain("room for 3 more guests")
    expect(roomLeftMessage({ hideCapacity: true, kind: "RESTAURANT" }, 3)).not.toMatch(/\d/)
  })
})
