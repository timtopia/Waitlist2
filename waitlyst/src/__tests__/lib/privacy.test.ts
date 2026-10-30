import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

describe("shortName / firstName", () => {
  it("shortens a full name to first name and last initial", async () => {
    const { shortName } = await import("@/lib/privacy")
    expect(shortName("Timothy Zhang")).toBe("Timothy Z.")
    expect(shortName("Mary Ann van der berg")).toBe("Mary B.")
  })

  it("keeps a single name as is and handles missing names", async () => {
    const { shortName } = await import("@/lib/privacy")
    expect(shortName("Cher")).toBe("Cher")
    expect(shortName("  ")).toBeNull()
    expect(shortName(null)).toBeNull()
  })

  it("takes the first word for public messages", async () => {
    const { firstName } = await import("@/lib/privacy")
    expect(firstName("Alice Walker")).toBe("Alice")
    expect(firstName(undefined)).toBeNull()
  })
})
