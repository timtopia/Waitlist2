import { describe, it, expect } from "vitest"
import { tradeBlocker } from "@/lib/trading"

describe("tradeBlocker", () => {
  const waiting = { userId: "a", fulfilled: false, calledAt: null }

  it("lets a waiting spot be traded", () => {
    expect(tradeBlocker(waiting, null, "theirs")).toBeNull()
  })

  it("blocks every called party, not just the one in 'now serving'", () => {
    // A restaurant host called "a", then called "b" out of order
    const calledEarlier = { ...waiting, calledAt: new Date() }
    expect(tradeBlocker(calledEarlier, "b", "yours")).toMatch(/called up/)
  })

  it("blocks a served spot", () => {
    expect(tradeBlocker({ ...waiting, fulfilled: true }, null, "theirs")).toMatch(/served/)
  })
})
