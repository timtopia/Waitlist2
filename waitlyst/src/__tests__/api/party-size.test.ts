import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = {
  line: { findUnique: vi.fn() },
  linePosition: { findUnique: vi.fn(), aggregate: vi.fn(), update: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

const mockAuth = vi.fn()
vi.mock("@/auth", () => ({ auth: () => mockAuth() }))

const params = { params: Promise.resolve({ lineId: "line-1" }) }

async function setPartySize(partySize: unknown) {
  const { PATCH } = await import("@/app/api/lines/[lineId]/party/route")
  return PATCH(
    new Request("http://localhost/api/lines/line-1/party", { method: "PATCH", body: JSON.stringify({ partySize }) }),
    params
  )
}

const restaurant = { id: "line-1", kind: "RESTAURANT", maxCapacity: 20 }
const myParty = { id: "pos-1", userId: "guest-1", partySize: 2, fulfilled: false }

describe("PATCH /api/lines/[lineId]/party", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "guest-1" } })
    mockPrisma.linePosition.update.mockImplementation(async ({ data }: { data: { partySize: number } }) => ({ ...myParty, ...data }))
  })

  it("lets a waiting guest add a friend when there's room", async () => {
    mockPrisma.line.findUnique.mockResolvedValue(restaurant)
    mockPrisma.linePosition.findUnique.mockResolvedValue(myParty)
    mockPrisma.linePosition.aggregate.mockResolvedValue({ _sum: { partySize: 18 } })

    const res = await setPartySize(4)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ partySize: 4 })
    // Takes the same line lock as joins so the last seats can't be double-booked
    expect(mockPrisma.$queryRaw.mock.calls[0][0].join("")).toContain("FOR UPDATE")
  })

  it("refuses to grow past the line's guest capacity", async () => {
    mockPrisma.line.findUnique.mockResolvedValue(restaurant)
    mockPrisma.linePosition.findUnique.mockResolvedValue(myParty)
    mockPrisma.linePosition.aggregate.mockResolvedValue({ _sum: { partySize: 19 } })

    const res = await setPartySize(4)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("There's only room for 1 more guest in this line")
    expect(mockPrisma.linePosition.update).not.toHaveBeenCalled()
  })

  it("always lets a party shrink, even on a full line", async () => {
    mockPrisma.line.findUnique.mockResolvedValue(restaurant)
    mockPrisma.linePosition.findUnique.mockResolvedValue({ ...myParty, partySize: 5 })

    const res = await setPartySize(3)

    expect(res.status).toBe(200)
    expect(mockPrisma.linePosition.aggregate).not.toHaveBeenCalled()
  })

  it("is only for restaurant lines", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ ...restaurant, kind: "STANDARD" })

    const res = await setPartySize(3)

    expect(res.status).toBe(400)
    expect(mockPrisma.linePosition.update).not.toHaveBeenCalled()
  })

  it("can't change once the party has been seated", async () => {
    mockPrisma.line.findUnique.mockResolvedValue(restaurant)
    mockPrisma.linePosition.findUnique.mockResolvedValue({ ...myParty, fulfilled: true })

    const res = await setPartySize(3)

    expect(res.status).toBe(400)
  })

  it("can't change once the host has called the party", async () => {
    mockPrisma.line.findUnique.mockResolvedValue(restaurant)
    mockPrisma.linePosition.findUnique.mockResolvedValue({ ...myParty, calledAt: new Date() })

    const res = await setPartySize(4)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/ask the host/)
    expect(mockPrisma.linePosition.update).not.toHaveBeenCalled()
  })

  it("lets the host change a called party's size, without the guest capacity check", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner-1" } })
    mockPrisma.line.findUnique.mockResolvedValue({ ...restaurant, createdById: "owner-1" })
    mockPrisma.linePosition.findUnique.mockResolvedValue({ ...myParty, calledAt: new Date() })

    const { PATCH } = await import("@/app/api/lines/[lineId]/party/route")
    const res = await PATCH(
      new Request("http://localhost/api/lines/line-1/party", {
        method: "PATCH",
        body: JSON.stringify({ partySize: 5, positionId: myParty.id }),
      }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )

    expect(res.status).toBe(200)
    expect(mockPrisma.linePosition.update).toHaveBeenCalledWith({ where: { id: myParty.id }, data: { partySize: 5 } })
  })

  it("won't let a guest change someone else's party", async () => {
    mockPrisma.line.findUnique.mockResolvedValue({ ...restaurant, createdById: "owner-1" })

    const { PATCH } = await import("@/app/api/lines/[lineId]/party/route")
    const res = await PATCH(
      new Request("http://localhost/api/lines/line-1/party", {
        method: "PATCH",
        body: JSON.stringify({ partySize: 5, positionId: "someone-else" }),
      }),
      { params: Promise.resolve({ lineId: "line-1" }) }
    )

    expect(res.status).toBe(400)
    expect(mockPrisma.linePosition.update).not.toHaveBeenCalled()
  })

  it("rejects sizes that aren't a whole number from 1 to 20", async () => {
    mockPrisma.line.findUnique.mockResolvedValue(restaurant)
    mockPrisma.linePosition.findUnique.mockResolvedValue(myParty)

    for (const bad of [0, 2.5, "4", 21]) {
      expect((await setPartySize(bad)).status).toBe(400)
    }
    expect(mockPrisma.linePosition.update).not.toHaveBeenCalled()
  })

  it("requires signing in", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await setPartySize(3)).status).toBe(401)
  })
})
