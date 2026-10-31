import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  lineReminder: { findMany: vi.fn(), updateMany: vi.fn() },
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
const sendEmail = vi.fn().mockResolvedValue(true)
let emailOn = true
vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  emailEnabled: () => emailOn,
}))
vi.mock("@/lib/stripe", () => ({ getBaseUrl: () => "https://waitlyst.test" }))

const reminder = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  line: { id: "line-1", name: "Sneaker drop", closesAt: null },
  user: { name: "Ben", email: `${id}@test.com`, emailNotifications: true },
  ...overrides,
})

describe("sendDueLineReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    emailOn = true
    mockPrisma.lineReminder.updateMany.mockResolvedValue({ count: 1 })
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
    expect(sendEmail).toHaveBeenCalledWith("r1@test.com", "Sneaker drop is open", expect.stringContaining("/lines/line-1"))
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
})

describe("GET /api/cron/line-reminders", () => {
  it("refuses callers without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret")
    const { GET } = await import("@/app/api/cron/line-reminders/route")

    const res = await GET(new Request("http://localhost/api/cron/line-reminders"))
    expect(res.status).toBe(401)
  })
})
