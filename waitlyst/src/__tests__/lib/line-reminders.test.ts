import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  lineReminder: { findMany: vi.fn(), updateMany: vi.fn() },
  linePosition: { findUnique: vi.fn() },
  line: { findMany: vi.fn() },
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
const sendEmail = vi.fn().mockResolvedValue(true)
let emailOn = true
vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  emailEnabled: () => emailOn,
}))
vi.mock("@/lib/stripe", () => ({ getBaseUrl: () => "https://waitlyst.test" }))
const expireMissedCalls = vi.fn()
vi.mock("@/lib/missed-calls", () => ({
  expireMissedCalls: (...args: unknown[]) => expireMissedCalls(...args),
}))

const reminder = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  lineId: "line-1",
  userId: `user-${id}`,
  line: { id: "line-1", name: "Sneaker drop", closesAt: null },
  user: { name: "Ben", email: `${id}@test.com`, emailNotifications: true },
  ...overrides,
})

describe("sendDueLineReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    emailOn = true
    mockPrisma.lineReminder.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.linePosition.findUnique.mockResolvedValue(null)
  })

  it("leaves reminders untouched while email isn't set up", async () => {
    emailOn = false
    const { sendDueLineReminders } = await import("@/lib/line-reminders")

    expect(await sendDueLineReminders()).toBe(0)
    expect(mockPrisma.lineReminder.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.lineReminder.updateMany).not.toHaveBeenCalled()
  })

  it("emails each person once the line has opened", async () => {
    mockPrisma.lineReminder.findMany.mockResolvedValue([reminder("r1"), reminder("r2")])
    const { sendDueLineReminders } = await import("@/lib/line-reminders")

    expect(await sendDueLineReminders("line-1")).toBe(2)
    expect(sendEmail).toHaveBeenCalledWith("r1@test.com", "Sneaker drop is open", expect.stringContaining("/lines/line-1"), expect.anything())
    // Only open, active lines are looked at
    expect(mockPrisma.lineReminder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sentAt: null, lineId: "line-1", line: { isActive: true, opensAt: { lte: expect.any(Date) } } }),
      })
    )
  })

  it("doesn't email a reminder another run already claimed", async () => {
    mockPrisma.lineReminder.findMany.mockResolvedValue([reminder("r1")])
    mockPrisma.lineReminder.updateMany.mockResolvedValue({ count: 0 })
    const { sendDueLineReminders } = await import("@/lib/line-reminders")

    expect(await sendDueLineReminders()).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("skips people who turned emails off and lines that already closed", async () => {
    mockPrisma.lineReminder.findMany.mockResolvedValue([
      reminder("r1", { user: { name: "A", email: "a@test.com", emailNotifications: false } }),
      reminder("r2", { line: { id: "line-1", name: "Old", closesAt: new Date(Date.now() - 1000) } }),
    ])
    const { sendDueLineReminders } = await import("@/lib/line-reminders")

    expect(await sendDueLineReminders()).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })
  it("doesn't tell someone who already joined to join now", async () => {
    mockPrisma.lineReminder.findMany.mockResolvedValue([reminder("r1"), reminder("r2")])
    mockPrisma.linePosition.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where.lineId_userId.userId === "user-r1" ? { id: "p1" } : null)
    )
    const { sendDueLineReminders } = await import("@/lib/line-reminders")

    expect(await sendDueLineReminders()).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith("r2@test.com", expect.any(String), expect.any(String), expect.anything())
  })

  it("retries a failed send under the same idempotency key, so it never lands twice", async () => {
    mockPrisma.lineReminder.findMany.mockResolvedValue([reminder("r1")])
    sendEmail.mockResolvedValueOnce(false)
    const { sendDueLineReminders } = await import("@/lib/line-reminders")

    expect(await sendDueLineReminders()).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(2)
    for (const call of sendEmail.mock.calls) {
      expect(call[3]).toEqual({ idempotencyKey: "line-reminder/r1" })
    }
  })
})

describe("GET /api/cron/line-reminders", () => {
  it("refuses callers without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret")
    const { GET } = await import("@/app/api/cron/line-reminders/route")

    const res = await GET(new Request("http://localhost/api/cron/line-reminders"))
    expect(res.status).toBe(401)
  })

  it("also skips no-shows on lines nobody is viewing, carrying on past a line that fails", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret")
    mockPrisma.lineReminder.findMany.mockResolvedValue([])
    mockPrisma.line.findMany.mockResolvedValue([
      { id: "line-a", responseWindowMinutes: 10 },
      { id: "line-b", responseWindowMinutes: 5 },
      { id: "line-c", responseWindowMinutes: 15 },
    ])
    expireMissedCalls
      .mockResolvedValueOnce(2)
      .mockRejectedValueOnce(new Error("deadlock"))
      .mockResolvedValueOnce(1)
    const { GET } = await import("@/app/api/cron/line-reminders/route")

    const res = await GET(new Request("http://localhost/api/cron/line-reminders", {
      headers: { authorization: "Bearer s3cret" },
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 0, skippedNoShows: 3 })
    expect(expireMissedCalls).toHaveBeenCalledWith("line-a", 10)
    expect(expireMissedCalls).toHaveBeenCalledWith("line-c", 15)
  })

  it("reports a failed job as a failure instead of a quiet 200", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret")
    mockPrisma.lineReminder.findMany.mockRejectedValue(new Error("db down"))
    mockPrisma.line.findMany.mockResolvedValue([])
    const { GET } = await import("@/app/api/cron/line-reminders/route")

    const res = await GET(new Request("http://localhost/api/cron/line-reminders", {
      headers: { authorization: "Bearer s3cret" },
    }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ sent: null, skippedNoShows: 0 })
  })
})
