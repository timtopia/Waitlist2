import { describe, it, expect, vi, beforeEach } from "vitest"

const send = vi.fn()
vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send } }
  }),
}))

describe("sendEmail", () => {
  beforeEach(() => {
    vi.resetModules()
    send.mockReset()
    vi.stubEnv("RESEND_API_KEY", "re_test")
  })

  it("sends from EMAIL_FROM when it's set", async () => {
    vi.stubEnv("EMAIL_FROM", "Waitlyst <hello@waitlyst.app>")
    send.mockResolvedValue({ data: { id: "e1" }, error: null })
    const { sendEmail } = await import("@/lib/email")

    expect(await sendEmail("a@test.com", "Hi", "<p>Hi</p>")).toBe(true)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: "Waitlyst <hello@waitlyst.app>" }))
  })

  it("sends nothing without EMAIL_FROM: the test sender would only reach the account owner", async () => {
    vi.stubEnv("EMAIL_FROM", "")
    const { sendEmail, emailEnabled } = await import("@/lib/email")

    expect(emailEnabled()).toBe(false)
    expect(await sendEmail("a@test.com", "Hi", "<p>Hi</p>")).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it("reports failure when Resend refuses the email instead of throwing", async () => {
    vi.stubEnv("EMAIL_FROM", "Waitlyst <hello@waitlyst.app>")
    send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "domain not verified" } })
    const { sendEmail } = await import("@/lib/email")

    expect(await sendEmail("a@test.com", "Hi", "<p>Hi</p>")).toBe(false)
  })
})
