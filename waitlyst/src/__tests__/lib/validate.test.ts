import { describe, it, expect } from "vitest"
import { jsonForScript } from "@/lib/validate"

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
