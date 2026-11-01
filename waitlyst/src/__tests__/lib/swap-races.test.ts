import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Multi-party scenarios against the real swap/payment core in lib/stripe.ts,
 * backed by a small stateful in-memory DB. $queryRaw models the row lock
 * (SELECT ... FOR UPDATE) as a per-line mutex held until the surrounding
 * $transaction ends, so concurrent calls genuinely interleave at awaits.
 */

type Pos = { id: string; lineId: string; userId: string; position: number; askingPrice: number | null; lockedUntil: Date | null; lockedBy: string | null; fulfilled?: boolean }
type Txn = {
  id: string; lineId: string; buyerId: string; sellerId: string; amount: number; ownerFee: number; platformFee: number; status: string
  stripePaymentId: string | null; settledAt: Date | null; capturedAt: Date | null; sellerPaidAt: Date | null; ownerPaidAt: Date | null; createdAt: Date
}
type Offer = { id: string; lineId: string; fromUserId: string; toUserId: string; amount: number; status: string; createdAt: Date; transactionId?: string | null }

const db = {
  positions: [] as Pos[],
  transactions: [] as Txn[],
  offers: [] as Offer[],
  users: [] as { id: string; name: string; email: string | null; emailNotifications: boolean; stripeConnectId: string | null; stripeConnectOnboarded: boolean }[],
  lines: [] as { id: string; name: string; createdById: string; nowServingUserId?: string | null; kind?: "STANDARD" | "RESTAURANT" }[],
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const lineLocks = new Map<string, Promise<void>>()

function matches<T extends Record<string, unknown>>(row: T, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Record<string, unknown>[]).some((c) => matches(row, c))
    const value = row[key]
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>
      if ("in" in c) return (c.in as unknown[]).includes(value)
      if ("lt" in c) return value instanceof Date && value < (c.lt as Date)
      if ("gt" in c) return typeof value === "number" && value > (c.gt as number)
      if ("not" in c) return value !== c.not
    }
    return value === cond
  })
}

// Like Prisma, hand out snapshots -- never live references to stored rows.
const copy = <T,>(row: T | undefined): T | null => (row ? { ...row } : null)

function table<T extends { id: string }>(rows: () => T[]) {
  return {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      await tick()
      if ("lineId_userId" in where) {
        const k = where.lineId_userId as { lineId: string; userId: string }
        return copy(rows().find((r) => matches(r as Record<string, unknown>, k)))
      }
      return copy(rows().find((r) => matches(r as Record<string, unknown>, where)))
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      await tick()
      return copy(rows().find((r) => matches(r as Record<string, unknown>, where)))
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      await tick()
      return rows().filter((r) => matches(r as Record<string, unknown>, where)).map((r) => ({ ...r }))
    }),
    update: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<T> }) => {
      await tick()
      const row = rows().find((r) => matches(r as Record<string, unknown>, where))
      if (!row) throw new Error("Record not found")
      Object.assign(row, data)
      return { ...row }
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<T> }) => {
      await tick()
      const hit = rows().filter((r) => matches(r as Record<string, unknown>, where))
      hit.forEach((r) => Object.assign(r, data))
      return { count: hit.length }
    }),
    create: vi.fn(async ({ data }: { data: Partial<T> }) => {
      await tick()
      const row = { id: `txn-${rows().length + 1}`, createdAt: new Date(), settledAt: null, stripePaymentId: null, ...data } as unknown as T
      rows().push(row)
      return row
    }),
  }
}

function makeClient(releaseLocks?: (() => void)[]) {
  return {
    linePosition: table(() => db.positions),
    transaction: table(() => db.transactions),
    swapOffer: table(() => db.offers),
    user: table(() => db.users),
    line: table(() => db.lines),
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, lineId: string) => {
      const previous = lineLocks.get(lineId) ?? Promise.resolve()
      let release!: () => void
      const mine = new Promise<void>((r) => (release = r))
      lineLocks.set(lineId, previous.then(() => mine))
      await previous
      releaseLocks?.push(release)
      return []
    }),
  }
}

const mockPrisma = {
  ...makeClient(),
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const held: (() => void)[] = []
    try {
      return await fn(makeClient(held))
    } finally {
      held.forEach((release) => release())
    }
  }),
}
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue(true) }))

const fakeStripe = {
  checkout: { sessions: { retrieve: vi.fn(), expire: vi.fn() } },
  paymentIntents: { retrieve: vi.fn(), capture: vi.fn(), cancel: vi.fn() },
  transfers: { list: vi.fn(), create: vi.fn() },
  refunds: { create: vi.fn() },
}
vi.mock("stripe", () => ({
  default: vi.fn(function () {
    return fakeStripe
  }),
}))
process.env.STRIPE_SECRET_KEY = "sk_test_fake"

function seed() {
  db.lines = [{ id: "line-1", name: "Drop", createdById: "owner" }]
  db.users = ["owner", "sam", "ben", "cal"].map((id) => ({
    id, name: id, email: null, emailNotifications: false, stripeConnectId: null, stripeConnectOnboarded: false,
  }))
  db.positions = [
    { id: "p-sam", lineId: "line-1", userId: "sam", position: 1, askingPrice: 40, lockedUntil: null, lockedBy: null },
    { id: "p-ben", lineId: "line-1", userId: "ben", position: 2, askingPrice: 1, lockedUntil: null, lockedBy: null },
    { id: "p-cal", lineId: "line-1", userId: "cal", position: 3, askingPrice: null, lockedUntil: null, lockedBy: null },
  ]
  db.transactions = []
  db.offers = []
  lineLocks.clear()
}

function addTxn(id: string, buyerId: string, sellerId: string, extra: Partial<Txn> = {}): Txn {
  const txn: Txn = {
    id, lineId: "line-1", buyerId, sellerId, amount: 40, ownerFee: 4, platformFee: 4,
    status: "PENDING", stripePaymentId: null, settledAt: null, capturedAt: null, sellerPaidAt: null, ownerPaidAt: null,
    createdAt: new Date(), ...extra,
  }
  db.transactions.push(txn)
  return txn
}

const posOf = (userId: string) => db.positions.find((p) => p.userId === userId)!.position

beforeEach(() => {
  vi.clearAllMocks()
  seed()
  fakeStripe.paymentIntents.retrieve.mockResolvedValue({ id: "pi_x", status: "requires_capture" })
  fakeStripe.checkout.sessions.retrieve.mockImplementation(async (id: string) => ({
    id, payment_intent: `pi_for_${id}`, metadata: {},
  }))
  fakeStripe.transfers.list.mockResolvedValue({ data: [] })
  fakeStripe.transfers.create.mockResolvedValue({ id: "tr_1" })
})

describe("performPositionSwap under concurrency", () => {
  it("webhook and return URL completing the same checkout at once swap exactly once", async () => {
    // Regression: both read PENDING, both swapped -- and the second swap put
    // the buyer straight back behind the seller after they'd paid.
    addTxn("t1", "ben", "sam", { stripePaymentId: "cs_1" })
    const { performPositionSwap } = await import("@/lib/stripe")

    const results = await Promise.all([performPositionSwap("t1"), performPositionSwap("t1")])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(posOf("ben")).toBe(1)
    expect(posOf("sam")).toBe(2)
    expect(db.transactions[0].status).toBe("COMPLETED")
    expect(fakeStripe.paymentIntents.cancel).not.toHaveBeenCalled()
  })

  it("two paid checkouts for the same spot: the second is refused and its hold released", async () => {
    // Ben double-clicked Buy (or a stale lock let a second checkout start).
    // Before: both completed and the second swap reversed the first.
    addTxn("t1", "ben", "sam", { stripePaymentId: "cs_1" })
    addTxn("t2", "ben", "sam", { stripePaymentId: "cs_2" })
    const { performPositionSwap } = await import("@/lib/stripe")

    const [first, second] = await Promise.all([performPositionSwap("t1"), performPositionSwap("t2")])

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(posOf("ben")).toBe(1)
    expect(db.transactions.find((t) => t.id === "t2")!.status).toBe("FAILED")
    expect(fakeStripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_for_cs_2")
  })

  it("a seller who left mid-checkout: FAILED sticks, locks clear, and the buyer's hold is released", async () => {
    // Regression: the failure was thrown inside the DB transaction, rolling
    // back FAILED + unlock, and the buyer's authorization was never released.
    addTxn("t1", "ben", "sam", { stripePaymentId: "cs_1" })
    db.positions.find((p) => p.userId === "ben")!.lockedBy = "t1"
    db.positions = db.positions.filter((p) => p.userId !== "sam")
    const { performPositionSwap } = await import("@/lib/stripe")

    expect(await performPositionSwap("t1")).toBe(false)
    expect(db.transactions[0].status).toBe("FAILED")
    expect(db.positions.every((p) => p.lockedBy === null)).toBe(true)
    expect(fakeStripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_for_cs_1")
  })

  it("paying for a checkout the owner already cancelled releases the hold instead of swapping", async () => {
    addTxn("t1", "ben", "sam", { stripePaymentId: "cs_1", status: "FAILED" })
    const { performPositionSwap } = await import("@/lib/stripe")

    expect(await performPositionSwap("t1")).toBe(false)
    expect(posOf("ben")).toBe(2)
    expect(fakeStripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_for_cs_1")
  })

  it("Ben's pending offer to Sam dies when Cal buys Ben's spot, and Ben's cheap listing doesn't follow him", async () => {
    // Sam(1) Ben(2) Cal(3). Ben offers Sam; meanwhile Cal buys Ben's $1 listing.
    db.offers.push({ id: "o-ben-sam", lineId: "line-1", fromUserId: "ben", toUserId: "sam", amount: 30, status: "PENDING", createdAt: new Date() })
    db.offers.push({ id: "o-cal-ben", lineId: "line-1", fromUserId: "cal", toUserId: "ben", amount: 2, status: "PENDING", createdAt: new Date() })
    addTxn("t1", "cal", "ben", { amount: 1 })
    const { performPositionSwap } = await import("@/lib/stripe")

    expect(await performPositionSwap("t1")).toBe(true)
    expect([posOf("sam"), posOf("cal"), posOf("ben")]).toEqual([1, 2, 3])
    expect(db.offers.every((o) => o.status === "EXPIRED")).toBe(true)
    expect(db.positions.find((p) => p.userId === "ben")!.askingPrice).toBeNull()
  })

  it("a seller who got served while the buyer was paying keeps their spot; the buyer's hold is released", async () => {
    // Before: the swap went through anyway, and the buyer paid to stand
    // behind... nobody -- served people don't count toward anyone's wait.
    addTxn("t1", "ben", "sam", { stripePaymentId: "cs_1" })
    db.positions.find((p) => p.userId === "sam")!.fulfilled = true
    const { performPositionSwap } = await import("@/lib/stripe")

    expect(await performPositionSwap("t1")).toBe(false)
    expect(posOf("sam")).toBe(1)
    expect(db.transactions[0].status).toBe("FAILED")
    expect(fakeStripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_for_cs_1")
  })

  it("a seller the organizer called up mid-checkout isn't pushed back behind the buyer", async () => {
    addTxn("t1", "ben", "sam", { stripePaymentId: "cs_1" })
    db.lines[0].nowServingUserId = "sam"
    const { performPositionSwap } = await import("@/lib/stripe")

    expect(await performPositionSwap("t1")).toBe(false)
    expect(posOf("sam")).toBe(1)
    expect(posOf("ben")).toBe(2)
  })

  it("the buyer's own old listing is cleared so the seller can't buy the better spot back cheaply", async () => {
    // Ben listed spot #2 at $1, then bought Sam's #1 for $40. Before, Ben's
    // $1 price moved with him to #1 and Sam (now right behind) could take it.
    addTxn("t1", "ben", "sam")
    const { performPositionSwap } = await import("@/lib/stripe")

    await performPositionSwap("t1")
    expect(db.positions.find((p) => p.userId === "ben")).toMatchObject({ position: 1, askingPrice: null })
  })
})

describe("when a swap's money moves", () => {
  beforeEach(() => {
    fakeStripe.paymentIntents.capture.mockResolvedValue({ id: "pi_x", status: "succeeded", latest_charge: "ch_1" })
  })

  it("a standard line collects and settles the purchase as soon as the spots swap", async () => {
    addTxn("t1", "ben", "sam", { stripePaymentId: "cs_1" })
    const { performPositionSwap } = await import("@/lib/stripe")

    expect(await performPositionSwap("t1")).toBe(true)

    expect(fakeStripe.paymentIntents.capture).toHaveBeenCalledWith("pi_x")
    const txn = db.transactions[0]
    expect(txn.status).toBe("COMPLETED")
    expect(txn.capturedAt).toBeInstanceOf(Date)
    expect(txn.settledAt).toBeInstanceOf(Date)
  })

  it("a restaurant line leaves the buyer's card on hold until they're seated", async () => {
    db.lines[0].kind = "RESTAURANT"
    addTxn("t1", "ben", "sam", { stripePaymentId: "cs_1" })
    const { performPositionSwap } = await import("@/lib/stripe")

    expect(await performPositionSwap("t1")).toBe(true)

    expect(posOf("ben")).toBe(1)
    expect(fakeStripe.paymentIntents.capture).not.toHaveBeenCalled()
    expect(db.transactions[0].settledAt).toBeNull()
  })

  it("a standard-line purchase that can't be collected stays open for the owner", async () => {
    fakeStripe.paymentIntents.retrieve.mockResolvedValue({ id: "pi_x", status: "canceled" })
    addTxn("t1", "ben", "sam", { stripePaymentId: "cs_1" })
    const { performPositionSwap } = await import("@/lib/stripe")

    expect(await performPositionSwap("t1")).toBe(true)

    expect(db.transactions[0].status).toBe("COMPLETED")
    expect(db.transactions[0].settledAt).toBeNull()
  })
})

describe("lockPositionsForTransaction", () => {
  it("only one of two concurrent checkouts on the same spot gets the lock", async () => {
    const { lockPositionsForTransaction } = await import("@/lib/stripe")
    const until = new Date(Date.now() + 30 * 60000)

    const [a, b] = await Promise.all([
      mockPrisma.$transaction((tx) => lockPositionsForTransaction(tx as never, ["p-ben", "p-sam"], "t-direct", until)),
      mockPrisma.$transaction((tx) => lockPositionsForTransaction(tx as never, ["p-cal", "p-ben"], "t-offer", until)),
    ])

    expect([a, b].filter(Boolean)).toHaveLength(1)
  })

  it("takes over a lock that has already expired", async () => {
    db.positions.forEach((p) => { p.lockedUntil = new Date(Date.now() - 1000); p.lockedBy = "old" })
    const { lockPositionsForTransaction } = await import("@/lib/stripe")
    const ok = await mockPrisma.$transaction((tx) =>
      lockPositionsForTransaction(tx as never, ["p-ben", "p-sam"], "t-new", new Date(Date.now() + 60000))
    )
    expect(ok).toBe(true)
  })
})

describe("abandonPendingTransaction", () => {
  it("a late cancel (stale tab) can't undo a completed swap", async () => {
    addTxn("t1", "ben", "sam", { status: "COMPLETED", stripePaymentId: "cs_1" })
    const { abandonPendingTransaction } = await import("@/lib/stripe")

    expect(await abandonPendingTransaction("t1")).toBe(false)
    expect(db.transactions[0].status).toBe("COMPLETED")
    expect(fakeStripe.checkout.sessions.expire).not.toHaveBeenCalled()
  })

  it("an expired/cancelled accepted-offer checkout unlocks both spots and hands the offer back", async () => {
    db.offers.push({ id: "o1", lineId: "line-1", fromUserId: "ben", toUserId: "sam", amount: 30, status: "ACCEPTED", createdAt: new Date() })
    addTxn("t1", "ben", "sam", { stripePaymentId: "cs_1" })
    db.positions.filter((p) => p.userId !== "cal").forEach((p) => {
      p.lockedBy = "t1"
      p.lockedUntil = new Date(Date.now() + 60000)
    })
    fakeStripe.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_1", metadata: { offerId: "o1" } })
    const { abandonPendingTransaction } = await import("@/lib/stripe")

    expect(await abandonPendingTransaction("t1")).toBe(true)
    expect(db.transactions[0].status).toBe("FAILED")
    expect(db.positions.every((p) => p.lockedBy === null)).toBe(true)
    expect(db.offers[0].status).toBe("PENDING")
    expect(fakeStripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_1")
  })

  it("finds the accepted offer by its recorded checkout, without asking Stripe", async () => {
    db.offers.push({ id: "o1", lineId: "line-1", fromUserId: "ben", toUserId: "sam", amount: 30, status: "ACCEPTED", createdAt: new Date(), transactionId: "t1" })
    // Another accepted offer between the same two people, from an earlier trade
    db.offers.push({ id: "o-old", lineId: "line-1", fromUserId: "ben", toUserId: "sam", amount: 5, status: "ACCEPTED", createdAt: new Date(), transactionId: "t0" })
    addTxn("t1", "ben", "sam", { stripePaymentId: "cs_1" })
    const { abandonPendingTransaction } = await import("@/lib/stripe")

    expect(await abandonPendingTransaction("t1")).toBe(true)
    expect(db.offers.find((o) => o.id === "o1")).toMatchObject({ status: "PENDING", transactionId: null })
    expect(db.offers.find((o) => o.id === "o-old")!.status).toBe("ACCEPTED")
    expect(fakeStripe.checkout.sessions.retrieve).not.toHaveBeenCalled()
  })
})

describe("releaseFunds (capture + payouts)", () => {
  const txn = () => addTxn("t1", "ben", "sam", { status: "COMPLETED", stripePaymentId: "cs_1" })

  function connect(userId: string, acct: string) {
    Object.assign(db.users.find((u) => u.id === userId)!, { stripeConnectId: acct, stripeConnectOnboarded: true })
  }

  it("destination charge: doesn't pay the seller a second time, but does send the owner fee from the charge", async () => {
    // Regression: fulfill transferred the seller's take again on top of the
    // destination charge (double payout from the platform balance).
    connect("sam", "acct_sam")
    connect("owner", "acct_owner")
    fakeStripe.paymentIntents.capture.mockResolvedValue({
      id: "pi_x", status: "succeeded", latest_charge: "ch_1", transfer_data: { destination: "acct_sam" },
    })
    const { releaseFunds } = await import("@/lib/stripe")

    expect(await releaseFunds(txn())).toMatchObject({ sellerPaidAt: expect.any(Date), ownerPaidAt: expect.any(Date) })
    expect(fakeStripe.transfers.create).toHaveBeenCalledTimes(1)
    expect(fakeStripe.transfers.create).toHaveBeenCalledWith(expect.objectContaining({
      destination: "acct_owner", amount: 400, source_transaction: "ch_1", transfer_group: "t1",
    }), { idempotencyKey: "t1:owner_fee" })
  })

  it("a deleted line's unpaid owner fee is never recorded as paid", async () => {
    // Regression: with the line gone, `!line` counted the owner as paid
    connect("sam", "acct_sam")
    fakeStripe.paymentIntents.capture.mockResolvedValue({
      id: "pi_x", status: "succeeded", latest_charge: "ch_1", transfer_data: null,
    })
    const t = txn()
    db.lines = []
    const { releaseFunds } = await import("@/lib/stripe")

    expect(await releaseFunds(t)).toMatchObject({ sellerPaidAt: expect.any(Date), ownerPaidAt: null })
  })

  it("seller who onboarded after checkout: pays them from the charge id, not the PaymentIntent id", async () => {
    // Regression: source_transaction was given a pi_ id, which Stripe
    // rejects -- the seller silently never got paid.
    connect("sam", "acct_sam")
    fakeStripe.paymentIntents.capture.mockResolvedValue({ id: "pi_x", status: "succeeded", latest_charge: "ch_1", transfer_data: null })
    const { releaseFunds } = await import("@/lib/stripe")

    await releaseFunds(txn())
    expect(fakeStripe.transfers.create).toHaveBeenCalledWith(expect.objectContaining({
      destination: "acct_sam", amount: 4000, source_transaction: "ch_1", transfer_group: "t1",
    }), { idempotencyKey: "t1:seller_payout" })
  })

  it("re-running a release never re-sends a payout already made", async () => {
    connect("sam", "acct_sam")
    connect("owner", "acct_owner")
    fakeStripe.paymentIntents.retrieve.mockResolvedValue({ id: "pi_x", status: "succeeded", latest_charge: "ch_1", transfer_data: null })
    fakeStripe.transfers.list.mockResolvedValue({
      data: [{ metadata: { type: "seller_payout" } }, { metadata: { type: "owner_fee" } }],
    })
    const { releaseFunds } = await import("@/lib/stripe")

    expect(await releaseFunds(txn())).toMatchObject({ sellerPaidAt: expect.any(Date), ownerPaidAt: expect.any(Date) })
    expect(fakeStripe.transfers.create).not.toHaveBeenCalled()
  })

  it("a seller with no payout account is reported unpaid, while the owner is paid", async () => {
    connect("owner", "acct_owner")
    fakeStripe.paymentIntents.capture.mockResolvedValue({ id: "pi_x", status: "succeeded", latest_charge: "ch_1", transfer_data: null })
    const { releaseFunds } = await import("@/lib/stripe")

    expect(await releaseFunds(txn())).toMatchObject({ capturedAt: expect.any(Date), sellerPaidAt: null, ownerPaidAt: expect.any(Date) })
  })

  it("a failed transfer is reported unpaid so catch-up retries it", async () => {
    connect("sam", "acct_sam")
    fakeStripe.paymentIntents.capture.mockResolvedValue({ id: "pi_x", status: "succeeded", latest_charge: "ch_1", transfer_data: null })
    fakeStripe.transfers.create.mockRejectedValueOnce(new Error("account restricted"))
    const { releaseFunds } = await import("@/lib/stripe")

    expect((await releaseFunds(txn()))?.sellerPaidAt).toBeNull()
  })

  it("reports failure when the hold lapsed, so callers don't mark it paid out", async () => {
    fakeStripe.paymentIntents.retrieve.mockResolvedValue({ id: "pi_x", status: "canceled" })
    const { releaseFunds } = await import("@/lib/stripe")

    expect(await releaseFunds(txn())).toBeNull()
    expect(fakeStripe.transfers.create).not.toHaveBeenCalled()
  })

  it("releaseAndSettle records capture and payouts, and leaves a lapsed hold open", async () => {
    connect("sam", "acct_sam")
    fakeStripe.paymentIntents.capture.mockResolvedValue({ id: "pi_x", status: "succeeded", latest_charge: "ch_1", transfer_data: null })
    const { releaseAndSettle } = await import("@/lib/stripe")

    expect(await releaseAndSettle(txn())).toBe(true)
    expect(db.transactions[0]).toMatchObject({
      settledAt: expect.any(Date), capturedAt: expect.any(Date), sellerPaidAt: expect.any(Date), ownerPaidAt: null,
    })

    addTxn("t2", "cal", "ben", { status: "COMPLETED", stripePaymentId: "cs_2" })
    fakeStripe.paymentIntents.retrieve.mockResolvedValue({ id: "pi_y", status: "canceled" })
    expect(await releaseAndSettle(db.transactions[1])).toBe(false)
    expect(db.transactions[1]).toMatchObject({ settledAt: null, capturedAt: null })
  })

  it("catch-up: a seller who finishes payout setup later gets the sale captured while they had no account", async () => {
    addTxn("t1", "ben", "sam", { status: "COMPLETED", stripePaymentId: "cs_1", settledAt: new Date(), capturedAt: new Date() })
    connect("sam", "acct_sam")
    fakeStripe.paymentIntents.retrieve.mockResolvedValue({ id: "pi_x", status: "succeeded", latest_charge: "ch_1", transfer_data: null })
    const { payOutstandingPayouts } = await import("@/lib/stripe")

    await payOutstandingPayouts("sam")
    expect(fakeStripe.transfers.create).toHaveBeenCalledWith(expect.objectContaining({ destination: "acct_sam", amount: 4000 }), expect.anything())
    expect(db.transactions[0].sellerPaidAt).toBeInstanceOf(Date)

    // Coming back to the payout page again doesn't re-send it, even if
    // Stripe's transfer listing were to come back empty.
    fakeStripe.transfers.create.mockClear()
    await payOutstandingPayouts("sam")
    expect(fakeStripe.transfers.create).not.toHaveBeenCalled()
  })

  it("catch-up skips purchases that were never collected", async () => {
    addTxn("t1", "ben", "sam", { status: "COMPLETED", stripePaymentId: "cs_1" })
    connect("sam", "acct_sam")
    const { payOutstandingPayouts } = await import("@/lib/stripe")

    await payOutstandingPayouts("sam")
    expect(fakeStripe.transfers.create).not.toHaveBeenCalled()
  })
})
