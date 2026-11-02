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

  it("sends a plain-text version alongside the HTML, keeping link URLs", async () => {
    vi.stubEnv("EMAIL_FROM", "Waitlyst <hello@waitlyst.app>")
    send.mockResolvedValue({ data: { id: "e1" }, error: null })
    const { sendEmail } = await import("@/lib/email")
    const { positionCalledEmail } = await import("@/lib/email-templates")
    const { subject, html } = positionCalledEmail("Ann & Bo", "Dinner", "https://waitlyst.test/lines/1?a=1&b=2", { windowMinutes: 10 })

    await sendEmail("a@test.com", subject, html)
    const { text } = send.mock.calls[0][0]
    expect(text).toContain("You're up, Ann & Bo!")
    expect(text).toContain("You have 10 min to get there")
    expect(text).toContain("Go to Line: https://waitlyst.test/lines/1?a=1&b=2")
    expect(text).not.toMatch(/<|&amp;/)
  })

  it("passes an idempotency key through so a retry can't send twice", async () => {
    vi.stubEnv("EMAIL_FROM", "Waitlyst <hello@waitlyst.app>")
    send.mockResolvedValue({ data: { id: "e1" }, error: null })
    const { sendEmail } = await import("@/lib/email")

    await sendEmail("a@test.com", "Hi", "<p>Hi</p>", { idempotencyKey: "line-reminder/r1" })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "a@test.com" }), { idempotencyKey: "line-reminder/r1" })
  })

  it("reports failure when Resend refuses the email instead of throwing", async () => {
    vi.stubEnv("EMAIL_FROM", "Waitlyst <hello@waitlyst.app>")
    send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "domain not verified" } })
    const { sendEmail } = await import("@/lib/email")

    expect(await sendEmail("a@test.com", "Hi", "<p>Hi</p>")).toBe(false)
  })
})
