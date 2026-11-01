import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  transaction: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  linePosition: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  swapOffer: { updateMany: vi.fn() },
  user: { findUnique: vi.fn() },
  line: { findUnique: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([]),
  $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma)),
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

const mockSendEmail = vi.fn().mockResolvedValue(true)
vi.mock("@/lib/email", () => ({ sendEmail: (...args: unknown[]) => mockSendEmail(...args) }))

describe("email templates", () => {
  it("escapes user-controlled names in the HTML body but keeps the subject plain text", async () => {
    const { positionCalledEmail } = await import("@/lib/email-templates")
    const { subject, html } = positionCalledEmail(
      "<b>Mallory</b>",
      `Drop <a href="https://evil.example">click</a>`,
      "https://waitlyst.test/lines/1"
    )
    expect(html).not.toContain(`<a href="https://evil.example">`)
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;")
    expect(html).toContain("&lt;b&gt;Mallory&lt;/b&gt;")
    expect(subject).toContain(`Drop <a href="https://evil.example">click</a>`)
  })

  it("tells the seller what they sold for and their new position", async () => {
    const { positionSoldEmail } = await import("@/lib/email-templates")
    const { subject, html } = positionSoldEmail("Sam", "Nova Drop", 90, 2, "https://waitlyst.test/lines/1")
    expect(subject).toBe("Your spot in Nova Drop sold for $90.00")
    expect(html).toContain("#2")
  })

  it("tells a called restaurant party to head to the host stand, with their time limit", async () => {
    const { positionCalledEmail } = await import("@/lib/email-templates")
    const { html } = positionCalledEmail("Ann", "Dinner", "https://waitlyst.test/lines/1", { isRestaurant: true, windowMinutes: 10 })
    expect(html).toContain("Your table is ready at <strong>Dinner</strong>. Head to the host stand.")
    expect(html).toContain("You have 10 min to get there, or your place goes to the next party.")
    const noWindow = positionCalledEmail("Ann", "Dinner", "https://waitlyst.test/lines/1", { isRestaurant: true, windowMinutes: null })
    expect(noWindow.html).not.toContain("min to get there")
  })

  it("says seated or served, never fulfilled", async () => {
    const { fulfilledEmail } = await import("@/lib/email-templates")
    expect(fulfilledEmail("Ann", "Dinner", "u", { isRestaurant: true }).subject).toBe("You've been seated at Dinner")
    const served = fulfilledEmail("Ann", "Bakery", "u")
    expect(served.subject).toBe("You've been served in Bakery")
    expect(served.html).not.toContain("fulfilled")
  })
})

describe("performPositionSwap seller notification", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("emails the seller once a swap completes", async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: "txn-1",
      lineId: "line-1",
      buyerId: "ben",
      sellerId: "sam",
      amount: 90,
      status: "PENDING",
    })
    // Inside the swap transaction: buyer at #2, seller at #1.
    // Afterwards (notification lookup): seller is now at #2.
    mockPrisma.linePosition.findUnique
      .mockResolvedValueOnce({ id: "pos-ben", position: 2 })
      .mockResolvedValueOnce({ id: "pos-sam", position: 1 })
      .mockResolvedValueOnce({ position: 2 })
    mockPrisma.user.findUnique.mockResolvedValue({
      name: "Sam",
      email: "sam@test.local",
      emailNotifications: true,
    })
    mockPrisma.line.findUnique.mockResolvedValue({ name: "Nova Drop" })

    const { performPositionSwap } = await import("@/lib/stripe")
    const swapped = await performPositionSwap("txn-1")
    expect(swapped).toBe(true)

    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalledTimes(1))
    const [to, subject] = mockSendEmail.mock.calls[0]
    expect(to).toBe("sam@test.local")
    expect(subject).toContain("sold for $90.00")
  })

  it("respects the seller's email opt-out", async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: "txn-1",
      lineId: "line-1",
      buyerId: "ben",
      sellerId: "sam",
      amount: 90,
      status: "PENDING",
    })
    mockPrisma.linePosition.findUnique
      .mockResolvedValueOnce({ id: "pos-ben", position: 2 })
      .mockResolvedValueOnce({ id: "pos-sam", position: 1 })
      .mockResolvedValueOnce({ position: 2 })
    mockPrisma.user.findUnique.mockResolvedValue({
      name: "Sam",
      email: "sam@test.local",
      emailNotifications: false,
    })
    mockPrisma.line.findUnique.mockResolvedValue({ name: "Nova Drop" })

    const { performPositionSwap } = await import("@/lib/stripe")
    await performPositionSwap("txn-1")
    // Give the fire-and-forget lookup a chance to run before asserting nothing was sent.
    await new Promise((r) => setTimeout(r, 0))
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
