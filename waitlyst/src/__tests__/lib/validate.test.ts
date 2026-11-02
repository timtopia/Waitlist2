import { describe, it, expect } from "vitest"
import { cleanDisplayName, jsonForScript } from "@/lib/validate"

describe("cleanDisplayName", () => {
  it("strips bidi overrides and zero-width characters and collapses spaces", () => {
    expect(cleanDisplayName("  Host\u202E  \u200Bnimda ")).toBe("Host nimda")
  })

  it("refuses names with nothing readable in them", () => {
    expect(cleanDisplayName("\u200B\u200B")).toMatchObject({ error: expect.any(String) })
    expect(cleanDisplayName("---")).toMatchObject({ error: expect.stringContaining("letter or number") })
  })

  it("keeps the 1-50 character limit", () => {
    expect(cleanDisplayName("a".repeat(51))).toMatchObject({ error: expect.any(String) })
    expect(cleanDisplayName("Dana")).toBe("Dana")
  })
})

describe("jsonForScript", () => {
  it("can't close the script tag it is written into", () => {
    const out = jsonForScript({ name: "</script><script>alert(1)</script>", d: "a & b" })
    expect(out).not.toContain("<")
    expect(out).not.toContain(">")
    expect(out).not.toContain("&")
  })

  it("still parses back to the same data", () => {
    const value = { name: "</script> & <b>", n: 3 }
    expect(JSON.parse(jsonForScript(value))).toEqual(value)
  })
})
