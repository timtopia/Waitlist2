import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  line: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  linePosition: {
    findFirst: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  },
  transaction: {
    findMany: vi.fn(),
  },
  queueVisit: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  swapOffer: {
    updateMany: vi.fn(),
  },
  $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
}

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))

const sendEmail = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/email", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))

const abandonPendingTransaction = vi.fn().mockResolvedValue(true)
vi.mock("@/lib/stripe", () => ({ abandonPendingTransaction: (...a: unknown[]) => abandonPendingTransaction(...a) }))

const params = { params: Promise.resolve({ lineId: "line-1" }) }

function asOwner() {
  mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
  mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })
}

describe("POST /api/lines/[lineId]/call-next", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calls the first person who hasn't been served yet, not simply position 1", async () => {
    asOwner()
    mockPrisma.linePosition.findFirst.mockResolvedValue({
      id: "pos-2",
      userId: "bob",
      position: 2,
      lockedBy: null,
      lockedUntil: null,
      user: { name: "Bob", email: null, emailNotifications: false },
    })
    mockPrisma.line.update.mockResolvedValue({ id: "line-1", name: "Line" })

    const { POST } = await import("@/app/api/lines/[lineId]/call-next/route")
    const res = await POST(new Request("http://localhost/api/lines/line-1/call-next", { method: "POST" }), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ calledUser: "Bob", calledUserId: "bob", position: 2, positionId: "pos-2" })
    expect(mockPrisma.linePosition.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lineId: "line-1", fulfilled: false },
        orderBy: { position: "asc" },
      })
    )
    expect(mockPrisma.line.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nowServing: "Bob", nowServingUserId: "bob" }) })
    )
    // Their spot is at the counter now: listing down, offers expired
    expect(mockPrisma.linePosition.update).toHaveBeenCalledWith({
      where: { id: "pos-2" },
      data: { calledAt: expect.any(Date), askingPrice: null, response: null, respondedAt: null },
    })
    expect(mockPrisma.swapOffer.updateMany).toHaveBeenCalledWith({
      where: { lineId: "line-1", status: "PENDING", OR: [{ fromUserId: "bob" }, { toUserId: "bob" }] },
      data: { status: "EXPIRED" },
    })
    expect(abandonPendingTransaction).not.toHaveBeenCalled()
  })

  it("emails the person now on deck the first time someone is called, not on a re-call", async () => {
    asOwner()
    const front = {
      id: "pos-1", userId: "ann", position: 1, lockedBy: null, lockedUntil: null, calledAt: null as Date | null,
      user: { name: "Ann", email: null, emailNotifications: false },
    }
    const onDeck = {
      id: "pos-2", userId: "bob", position: 2,
      user: { name: "Bob", email: "bob@test", emailNotifications: true },
    }
    mockPrisma.linePosition.findFirst.mockResolvedValueOnce(front).mockResolvedValueOnce(onDeck)
    mockPrisma.line.update.mockResolvedValue({ id: "line-1", name: "Drop" })

    const { POST } = await import("@/app/api/lines/[lineId]/call-next/route")
    const call = () => POST(new Request("http://localhost/api/lines/line-1/call-next", { method: "POST" }), params)

    await call()
    expect(mockPrisma.linePosition.findFirst).toHaveBeenLastCalledWith(
      // Parties already called out of order are skipped
      expect.objectContaining({ where: { lineId: "line-1", fulfilled: false, calledAt: null, position: { gt: 1 } } })
    )
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toBe("bob@test")
    expect(sendEmail.mock.calls[0][1]).toBe("You're next in Drop")

    // Ann is called again: Bob already knows
    sendEmail.mockClear()
    mockPrisma.linePosition.findFirst.mockResolvedValueOnce({ ...front, calledAt: new Date() })
    await call()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("calls off a swap still on the payment page so the called person isn't pushed back", async () => {
    asOwner()
    mockPrisma.linePosition.findFirst.mockResolvedValue({
      id: "pos-1",
      userId: "ann",
      position: 1,
      lockedBy: "txn-buying-ann",
      lockedUntil: new Date(Date.now() + 10 * 60000),
      user: { name: "Ann", email: null, emailNotifications: false },
    })
    mockPrisma.line.update.mockResolvedValue({ id: "line-1", name: "Line" })

    const { POST } = await import("@/app/api/lines/[lineId]/call-next/route")
    const res = await POST(new Request("http://localhost/api/lines/line-1/call-next", { method: "POST" }), params)

    expect(res.status).toBe(200)
    expect(abandonPendingTransaction).toHaveBeenCalledWith("txn-buying-ann")
  })

  it("says everyone has been served when only served people remain", async () => {
    asOwner()
    mockPrisma.linePosition.findFirst.mockResolvedValue(null)
    mockPrisma.linePosition.count.mockResolvedValue(3)

    const { POST } = await import("@/app/api/lines/[lineId]/call-next/route")
    const res = await POST(new Request("http://localhost/api/lines/line-1/call-next", { method: "POST" }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Everyone in line has already been served")
    expect(mockPrisma.line.update).not.toHaveBeenCalled()
  })

  it("says no one is in line when the line is empty", async () => {
    asOwner()
    mockPrisma.linePosition.findFirst.mockResolvedValue(null)
    mockPrisma.linePosition.count.mockResolvedValue(0)

    const { POST } = await import("@/app/api/lines/[lineId]/call-next/route")
    const res = await POST(new Request("http://localhost/api/lines/line-1/call-next", { method: "POST" }), params)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("No one in line to call")
  })

  it("rejects non-owners", async () => {
    mockAuth.mockResolvedValue({ user: { id: "someone-else" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1" })

    const { POST } = await import("@/app/api/lines/[lineId]/call-next/route")
    const res = await POST(new Request("http://localhost/api/lines/line-1/call-next", { method: "POST" }), params)

    expect(res.status).toBe(403)
    expect(mockPrisma.linePosition.findFirst).not.toHaveBeenCalled()
  })
})

describe("POST /api/lines/[lineId]/call-next -- restaurant hosts calling a party", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const ann = { id: "pos-1", userId: "ann", position: 1, partySize: 6, lockedBy: null, lockedUntil: null, calledAt: null, user: { name: "Ann", email: "ann@x", emailNotifications: true } }
  const bob = { id: "pos-2", userId: "bob", position: 2, partySize: 2, lockedBy: null, lockedUntil: null, calledAt: null, user: { name: "Bob", email: "bob@x", emailNotifications: true } }

  function call(body: unknown) {
    return import("@/app/api/lines/[lineId]/call-next/route").then(({ POST }) =>
      POST(new Request("http://localhost/api/lines/line-1/call-next", { method: "POST", body: JSON.stringify(body) }), params)
    )
  }

  it("seats a party of 2 at a free two-top ahead of the party of 6 at the front", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1", kind: "RESTAURANT" })
    mockPrisma.linePosition.findFirst.mockResolvedValueOnce(ann).mockResolvedValueOnce(bob)
    mockPrisma.line.update.mockResolvedValue({ id: "line-1", name: "Dinner" })

    const res = await call({ positionId: "pos-2" })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ calledUserId: "bob", partySize: 2, positionId: "pos-2" })
    expect(mockPrisma.line.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nowServing: "Bob (party of 2)", nowServingUserId: "bob" }) })
    )
    // Ann keeps her place and isn't told she's "next" because of it
    expect(mockPrisma.linePosition.update).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toBe("bob@x")
  })

  it("won't call someone out of order on a standard line", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1", kind: "STANDARD" })
    mockPrisma.linePosition.findFirst.mockResolvedValueOnce(ann)

    const res = await call({ positionId: "pos-2" })

    expect(res.status).toBe(400)
    expect(mockPrisma.line.update).not.toHaveBeenCalled()
  })

  it("says so when the named party has already left or been seated", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ id: "line-1", createdById: "owner-1", kind: "RESTAURANT" })
    mockPrisma.linePosition.findFirst.mockResolvedValueOnce(ann).mockResolvedValueOnce(null)

    const res = await call({ positionId: "pos-gone" })

    expect(res.status).toBe(404)
    expect(mockPrisma.line.update).not.toHaveBeenCalled()
  })
})

describe("GET /api/lines/[lineId]/stats -- owner fee earnings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reports the owner's own fee cut separately from swap volume", async () => {
    asOwner()
    mockPrisma.transaction.findMany.mockResolvedValue([
      { id: "t1", status: "COMPLETED", amount: 100, ownerFee: 10, settledAt: new Date(), createdAt: new Date() },
      { id: "t2", status: "COMPLETED", amount: 40, ownerFee: 4, settledAt: null, createdAt: new Date() },
      { id: "t3", status: "REFUNDED", amount: 30, ownerFee: 3, settledAt: new Date(), createdAt: new Date() },
      { id: "t4", status: "PENDING", amount: 20, ownerFee: 2, settledAt: null, createdAt: new Date() },
    ])

    const { GET } = await import("@/app/api/lines/[lineId]/stats/route")
    const res = await GET(new Request("http://localhost/api/lines/line-1/stats"), params)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ownerFeeEarned).toBe(10)
    expect(data.ownerFeePending).toBe(4)
    expect(data.totalCompleted).toBe(100)
  })
})
