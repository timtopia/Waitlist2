import { describe, it, expect } from "vitest"
import { capacityView } from "@/lib/capacity"

const line = { maxCapacity: 5, hideCapacity: false, createdById: "owner" }

describe("capacityView", () => {
  it("shows the limit when it isn't hidden", () => {
    expect(capacityView(line, 2)).toEqual({ maxCapacity: 5, hasCapacityLimit: true, isFull: false })
  })

  it("reports full at the limit", () => {
    expect(capacityView(line, 5).isFull).toBe(true)
  })

  it("hides the limit from anyone but the owner", () => {
    const hidden = { ...line, hideCapacity: true }
    expect(capacityView(hidden, 5, "member")).toEqual({ maxCapacity: null, hasCapacityLimit: true, isFull: true })
    expect(capacityView(hidden, 5)).toMatchObject({ maxCapacity: null })
    expect(capacityView(hidden, 5, "owner")).toMatchObject({ maxCapacity: 5 })
  })

  it("has no limit and is never full without a capacity", () => {
    expect(capacityView({ ...line, maxCapacity: null, hideCapacity: true }, 100)).toEqual({
      maxCapacity: null,
      hasCapacityLimit: false,
      isFull: false,
    })
  })
})
