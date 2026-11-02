import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { QueueDisplay } from "@/components/QueueDisplay"
import { useSession } from "next-auth/react"
import { useToast } from "@/components/ui/Toast"

// Mock fetch
global.fetch = vi.fn()

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
}))

const mockPositions = [
  {
    id: "pos-1",
    position: 1,
    askingPrice: 25.00,
    lockedUntil: null,
    user: { id: "user-1", name: "Alice", image: null },
  },
  {
    id: "pos-2",
    position: 2,
    askingPrice: null,
    lockedUntil: null,
    user: { id: "user-2", name: "Bob", image: null },
  },
  {
    id: "pos-3",
    position: 3,
    askingPrice: null,
    lockedUntil: null,
    user: { id: "user-3", name: "Charlie", image: null },
  },
]

describe("QueueDisplay", () => {
  const mockOnRefresh = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/offer")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ sent: [], received: [] }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    })
  })

  it("renders empty state when no positions", () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      status: "unauthenticated",
    })

    render(
      <QueueDisplay
        lineId="line-1"
        positions={[]}
        onRefresh={mockOnRefresh}
      />
    )

    expect(screen.getByText("No one in line yet — be the first.")).toBeInTheDocument()
  })

  it("gives the owner and paused lines their own empty-state copy", () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "creator-1" } },
      status: "authenticated",
    })

    const { rerender } = render(
      <QueueDisplay lineId="line-1" positions={[]} onRefresh={mockOnRefresh} isCreator={true} />
    )
    expect(screen.getByText(/Share the line's link/)).toBeInTheDocument()

    rerender(<QueueDisplay lineId="line-1" positions={[]} onRefresh={mockOnRefresh} isPaused={true} />)
    expect(screen.getByText("No one in line yet.")).toBeInTheDocument()
  })

  it("renders all positions", () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "viewer" } },
      status: "authenticated",
    })

    render(
      <QueueDisplay
        lineId="line-1"
        positions={mockPositions}
        onRefresh={mockOnRefresh}
      />
    )

    expect(screen.getByText("Alice")).toBeInTheDocument()
    expect(screen.getByText("Bob")).toBeInTheDocument()
    expect(screen.getByText("Charlie")).toBeInTheDocument()
  })

  it("shows (You) label for current user", () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-2" } },
      status: "authenticated",
    })

    render(
      <QueueDisplay
        lineId="line-1"
        positions={mockPositions}
        onRefresh={mockOnRefresh}
      />
    )

    expect(screen.getByText("(You)")).toBeInTheDocument()
  })

  it("shows (Next up) label for first position", () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "viewer" } },
      status: "authenticated",
    })

    render(
      <QueueDisplay
        lineId="line-1"
        positions={mockPositions}
        onRefresh={mockOnRefresh}
      />
    )

    expect(screen.getByText("(Next up)")).toBeInTheDocument()
  })

  it("moves (Next up) past people who have already been served", () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "viewer" } },
      status: "authenticated",
    })

    const positions = mockPositions.map((p) => (p.id === "pos-1" ? { ...p, fulfilled: true } : p))
    render(<QueueDisplay lineId="line-1" positions={positions} onRefresh={mockOnRefresh} />)

    const nextUp = screen.getByText("(Next up)")
    expect(nextUp.parentElement).toHaveTextContent("Bob")
  })

  it("shows Offer to Swap button for position directly in front", () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-2" } },
      status: "authenticated",
    })

    render(
      <QueueDisplay
        lineId="line-1"
        positions={mockPositions}
        onRefresh={mockOnRefresh}
      />
    )

    expect(screen.getByText("Offer to Swap")).toBeInTheDocument()
  })

  it("doesn't offer a swap with someone who has been called up", () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-2" } },
      status: "authenticated",
    })

    // Restaurant hosts call parties out of order, so "now serving" may be someone else
    const called = mockPositions.map((p) => (p.id === "pos-1" ? { ...p, calledAt: new Date().toISOString() } : p))
    render(
      <QueueDisplay
        lineId="line-1"
        positions={called}
        onRefresh={mockOnRefresh}
        nowServingUserId="user-3"
      />
    )

    expect(screen.queryByText("Offer to Swap")).not.toBeInTheDocument()
  })

  it("shows the host how long each party has waited and flags ones past their quote", () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "creator-1" } },
      status: "authenticated",
    })

    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
    render(
      <QueueDisplay
        lineId="line-1"
        positions={[
          { ...mockPositions[0], joinedAt: minutesAgo(75), quotedMinutes: 15, quotedAt: minutesAgo(30) },
          { ...mockPositions[1], joinedAt: minutesAgo(12) },
        ]}
        onRefresh={mockOnRefresh}
        isCreator={true}
        isRestaurant={true}
      />
    )

    expect(screen.getByText(/waiting 1 hr 15 min/)).toHaveTextContent("past quote")
    expect(screen.getByText("waiting 12 min")).toBeInTheDocument()
  })

  it("shows offer input when Offer to Swap is clicked", () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-2" } },
      status: "authenticated",
    })

    render(
      <QueueDisplay
        lineId="line-1"
        positions={mockPositions}
        onRefresh={mockOnRefresh}
      />
    )

    const offerButton = screen.getByText("Offer to Swap")
    fireEvent.click(offerButton)

    expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument()
    expect(screen.getByText("Send Offer")).toBeInTheDocument()
  })

  it("shows incoming offer with accept/decline buttons", async () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-1" } },
      status: "authenticated",
    })

    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/offer")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sent: [],
            received: [
              {
                id: "offer-1",
                lineId: "line-1",
                fromUserId: "user-2",
                toUserId: "user-1",
                amount: 15,
                status: "PENDING",
                createdAt: new Date().toISOString(),
              },
            ],
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    })

    render(
      <QueueDisplay
        lineId="line-1"
        positions={mockPositions}
        onRefresh={mockOnRefresh}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Swap offer: \$15\.00 from Bob/)).toBeInTheDocument()
    })

    expect(screen.getByText("Accept")).toBeInTheDocument()
    expect(screen.getByText("Decline")).toBeInTheDocument()
  })

  it("shows pending offer status", async () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-2" } },
      status: "authenticated",
    })

    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/offer")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sent: [
              {
                id: "offer-1",
                lineId: "line-1",
                fromUserId: "user-2",
                toUserId: "user-1",
                amount: 20,
                status: "PENDING",
                createdAt: new Date().toISOString(),
              },
            ],
            received: [],
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    })

    render(
      <QueueDisplay
        lineId="line-1"
        positions={mockPositions}
        onRefresh={mockOnRefresh}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Offer sent: \$20\.00/)).toBeInTheDocument()
      expect(screen.getByText(/waiting for response/i)).toBeInTheDocument()
      expect(screen.getByText("Withdraw")).toBeInTheDocument()
    })
  })

  function mockOffers(sent: unknown[], received: unknown[] = []) {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/offer")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ sent, received }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  }

  it("still shows Complete Payment once the seller accepted and both spots locked", async () => {
    // Regression: accepting locks both spots, and the whole buy/offer block
    // was hidden for locked spots -- so the buyer could never reach payment.
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-2" } },
      status: "authenticated",
    })
    mockOffers([{
      id: "offer-1", lineId: "line-1", fromUserId: "user-2", toUserId: "user-1",
      amount: 20, status: "ACCEPTED", createdAt: new Date().toISOString(), awaitingPayment: true,
    }])
    const locked = new Date(Date.now() + 20 * 60000).toISOString()
    const positions = mockPositions.map((p) =>
      p.id === "pos-1" || p.id === "pos-2" ? { ...p, lockedUntil: locked } : p
    )

    render(<QueueDisplay lineId="line-1" positions={positions} onRefresh={mockOnRefresh} />)

    await waitFor(() => {
      expect(screen.getByText("Complete Payment")).toBeInTheDocument()
      expect(screen.getByText("Back Out")).toBeInTheDocument()
    })
    expect(screen.queryByText(/^Buy for/)).not.toBeInTheDocument()
  })

  it("lets the buyer make a new offer after one was declined (no dead end)", async () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-2" } },
      status: "authenticated",
    })
    mockOffers([{
      id: "offer-1", lineId: "line-1", fromUserId: "user-2", toUserId: "user-1",
      amount: 5, status: "DECLINED", createdAt: new Date().toISOString(),
    }])

    render(<QueueDisplay lineId="line-1" positions={mockPositions} onRefresh={mockOnRefresh} />)

    const button = await screen.findByText("Make a New Offer")
    fireEvent.click(button)
    expect(screen.getByText("Send Offer")).toBeInTheDocument()
  })

  it("shows the seller that an accepted offer is waiting on the buyer's payment", async () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-1" } },
      status: "authenticated",
    })
    mockOffers([], [{
      id: "offer-1", lineId: "line-1", fromUserId: "user-2", toUserId: "user-1",
      amount: 20, status: "ACCEPTED", createdAt: new Date().toISOString(), awaitingPayment: true,
    }])

    render(<QueueDisplay lineId="line-1" positions={mockPositions} onRefresh={mockOnRefresh} />)

    expect(await screen.findByText(/waiting for them to pay/)).toBeInTheDocument()
  })

  it("confirms a direct buy with the fee breakdown and sends the price the buyer saw", async () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-2" } },
      status: "authenticated",
    })

    render(
      <QueueDisplay
        lineId="line-1"
        positions={mockPositions}
        onRefresh={mockOnRefresh}
        feeInfo={{ ownerFeePercent: 10, platformFeePercent: 10 }}
      />
    )

    fireEvent.click(screen.getByText("Buy for $30.00"))
    expect(screen.getByText("Buy spot #1?")).toBeInTheDocument()
    expect(screen.getByText("Line owner fee")).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalledWith("/api/lines/line-1/checkout", expect.anything())

    fireEvent.click(screen.getByText("Confirm Swap"))
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/lines/line-1/checkout", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedPrice: 25, expectedSellerId: "user-1", expectedTotal: 30 }),
      }))
    })
  })

  it("shows Leave button for current user", () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-3" } },
      status: "authenticated",
    })

    render(
      <QueueDisplay
        lineId="line-1"
        positions={mockPositions}
        onRefresh={mockOnRefresh}
      />
    )

    expect(screen.getByText("Leave")).toBeInTheDocument()
  })

  it("shows Remove buttons for creator", () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "creator-1" } },
      status: "authenticated",
    })

    render(
      <QueueDisplay
        lineId="line-1"
        positions={mockPositions}
        onRefresh={mockOnRefresh}
        isCreator={true}
      />
    )

    const removeButtons = screen.getAllByText("Remove")
    expect(removeButtons.length).toBe(3) // One for each position
  })

  it("shows confirm modal before leaving a line", async () => {
    ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "user-3" } },
      status: "authenticated",
    })

    render(
      <QueueDisplay
        lineId="line-1"
        positions={mockPositions}
        onRefresh={mockOnRefresh}
      />
    )

    const leaveButton = screen.getByText("Leave")
    fireEvent.click(leaveButton)

    // Confirm modal should appear with title and message
    await waitFor(() => {
      expect(screen.getByText(/Are you sure you want to leave/)).toBeInTheDocument()
    })

    // Modal has a "Leave Line" confirm button and a "Cancel" button
    const confirmButton = screen.getByRole("button", { name: "Leave Line" })
    expect(confirmButton).toBeInTheDocument()

    // Clicking cancel should dismiss the modal and not call any leave/action fetch
    const cancelButton = screen.getByText("Cancel")
    fireEvent.click(cancelButton)
    // The only fetch calls should be automatic on mount (wait-time + offers)
    const fetchCalls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    const nonAutoFetchCalls = fetchCalls.filter(
      (call: unknown[]) => typeof call[0] === "string" && !call[0].includes("wait-time") && !call[0].includes("/offer")
    )
    expect(nonAutoFetchCalls).toHaveLength(0)
  })

  describe("Position Locking", () => {
    const lockedPositions = [
      {
        id: "pos-1",
        position: 1,
        askingPrice: 25.00,
        lockedUntil: new Date(Date.now() + 60000).toISOString(), // Locked for 1 minute
        user: { id: "user-1", name: "Alice", image: null },
      },
      {
        id: "pos-2",
        position: 2,
        askingPrice: null,
        lockedUntil: null,
        user: { id: "user-2", name: "Bob", image: null },
      },
    ]

    it("shows pending indicator for locked positions", () => {
      ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { user: { id: "viewer" } },
        status: "authenticated",
      })

      render(
        <QueueDisplay
          lineId="line-1"
          positions={lockedPositions}
          onRefresh={mockOnRefresh}
        />
      )

      expect(screen.getByText(/pending/i)).toBeInTheDocument()
    })

    it("does not show offer button for locked positions", () => {
      ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { user: { id: "user-2" } },
        status: "authenticated",
      })

      render(
        <QueueDisplay
          lineId="line-1"
          positions={lockedPositions}
          onRefresh={mockOnRefresh}
        />
      )

      expect(screen.queryByText("Offer to Swap")).not.toBeInTheDocument()
    })

    it("shows offer button when lock has expired", () => {
      const expiredLockPositions = [
        {
          id: "pos-1",
          position: 1,
          askingPrice: 25.00,
          lockedUntil: new Date(Date.now() - 60000).toISOString(), // Expired 1 minute ago
          user: { id: "user-1", name: "Alice", image: null },
        },
        {
          id: "pos-2",
          position: 2,
          askingPrice: null,
          lockedUntil: null,
          user: { id: "user-2", name: "Bob", image: null },
        },
      ]

      ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { user: { id: "user-2" } },
        status: "authenticated",
      })

      render(
        <QueueDisplay
          lineId="line-1"
          positions={expiredLockPositions}
          onRefresh={mockOnRefresh}
        />
      )

      expect(screen.getByText("Offer to Swap")).toBeInTheDocument()
    })
  })

  describe("Removal Modal", () => {
    it("opens removal modal when Remove is clicked", async () => {
      ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { user: { id: "creator-1" } },
        status: "authenticated",
      })

      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          asBuyer: [],
          asSeller: [],
          totalPaid: 0,
          totalReceived: 0,
          totalRefundedToBuyer: 0,
          totalRefundedAsSeller: 0,
          netAmount: 0,
            downstreamBuyers: [],
        }),
      })

      render(
        <QueueDisplay
          lineId="line-1"
          positions={mockPositions}
          onRefresh={mockOnRefresh}
          isCreator={true}
        />
      )

      const removeButtons = screen.getAllByText("Remove")
      fireEvent.click(removeButtons[0])

      await waitFor(() => {
        expect(screen.getByText(/Remove Alice/)).toBeInTheDocument()
      })
    })

    it("shows transaction info in removal modal", async () => {
      ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { user: { id: "creator-1" } },
        status: "authenticated",
      })

      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          asBuyer: [{ id: "txn-1", amount: 50 }],
          asSeller: [{ id: "txn-2", amount: 20 }],
          totalPaid: 50,
          totalReceived: 20,
          netAmount: -30,
          downstreamBuyers: [],
        }),
      })

      render(
        <QueueDisplay
          lineId="line-1"
          positions={mockPositions}
          onRefresh={mockOnRefresh}
          isCreator={true}
        />
      )

      const removeButtons = screen.getAllByText("Remove")
      fireEvent.click(removeButtons[0])

      await waitFor(() => {
        expect(screen.getByText("$50.00")).toBeInTheDocument()
        expect(screen.getByText("$20.00")).toBeInTheDocument()
        expect(screen.getByText("Net: $-30.00")).toBeInTheDocument()
      })
    })

    it("shows payout button in removal modal", async () => {
      ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { user: { id: "creator-1" } },
        status: "authenticated",
      })

      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          asBuyer: [],
          asSeller: [],
          totalPaid: 0,
          totalReceived: 0,
          totalRefundedToBuyer: 0,
          totalRefundedAsSeller: 0,
          netAmount: 0,
          downstreamBuyers: [],
        }),
      })

      render(
        <QueueDisplay
          lineId="line-1"
          positions={mockPositions}
          onRefresh={mockOnRefresh}
          isCreator={true}
        />
      )

      const removeButtons = screen.getAllByText("Remove")
      fireEvent.click(removeButtons[0])

      // Nothing to refund: a single plain Remove, no refund option
      await waitFor(() => {
        expect(screen.getByText(/Remove Alice/)).toBeInTheDocument()
      })
      expect(screen.queryByText(/Remove and refund/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Payout/)).not.toBeInTheDocument()
    })

    it("offers no refund when purchases were already paid out", async () => {
      ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { user: { id: "creator-1" } },
        status: "authenticated",
      })

      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          asBuyer: [{ id: "txn-1", amount: 50, status: "COMPLETED" }],
          asSeller: [],
          totalPaid: 50,
          totalReceived: 0,
          totalRefundedToBuyer: 0,
          totalRefundedAsSeller: 0,
          netAmount: -50,
          refundableCount: 0,
          refundableAmount: 0,
          downstreamBuyers: [],
        }),
      })

      render(
        <QueueDisplay
          lineId="line-1"
          positions={mockPositions}
          onRefresh={mockOnRefresh}
          isCreator={true}
        />
      )

      fireEvent.click(screen.getAllByText("Remove")[0])

      await waitFor(() => {
        expect(screen.getByText(/already been paid out/)).toBeInTheDocument()
      })
      expect(screen.queryByText(/Remove and refund/)).not.toBeInTheDocument()
    })

    it("shows refund button when user has purchases", async () => {
      ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { user: { id: "creator-1" } },
        status: "authenticated",
      })

      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          asBuyer: [{ id: "txn-1", amount: 50, status: "COMPLETED" }],
          asSeller: [],
          totalPaid: 50,
          totalReceived: 0,
          totalRefundedToBuyer: 0,
          totalRefundedAsSeller: 0,
          netAmount: -50,
          refundableCount: 1,
          refundableAmount: 57.5,
          downstreamBuyers: [],
        }),
      })

      render(
        <QueueDisplay
          lineId="line-1"
          positions={mockPositions}
          onRefresh={mockOnRefresh}
          isCreator={true}
        />
      )

      const removeButtons = screen.getAllByText("Remove")
      fireEvent.click(removeButtons[0])

      // The refund is what the buyer was charged, fees included
      await waitFor(() => {
        expect(screen.getByText("Remove and refund $57.50")).toBeInTheDocument()
      })
      expect(screen.getByText("Remove and keep purchase")).toBeInTheDocument()
    })

    it("calls remove-position API with payout action", async () => {
      ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { user: { id: "creator-1" } },
        status: "authenticated",
      })

      const fetchResponses: Record<string, unknown> = {
        "wait-time": { estimatedMinutesPerPerson: null, basedOn: 0 },
        "offer": { sent: [], received: [] },
        "position-transactions": {
          asBuyer: [],
          asSeller: [],
          totalPaid: 0,
          totalReceived: 0,
          netAmount: 0,
          downstreamBuyers: [],
        },
        "remove-position": { success: true },
      }
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
        const key = Object.keys(fetchResponses).find(k => url.includes(k))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(key ? fetchResponses[key] : {}),
        })
      })

      render(
        <QueueDisplay
          lineId="line-1"
          positions={mockPositions}
          onRefresh={mockOnRefresh}
          isCreator={true}
        />
      )

      const removeButtons = screen.getAllByText("Remove")
      fireEvent.click(removeButtons[0])

      await waitFor(() => {
        expect(screen.getByText(/Remove Alice/)).toBeInTheDocument()
      })

      const modal = screen.getByText(/Remove Alice/).parentElement!
      const modalRemove = within(modal).getByRole("button", { name: "Remove" })
      await waitFor(() => expect(modalRemove).not.toBeDisabled())
      fireEvent.click(modalRemove)

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/lines/line-1/remove-position",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ positionId: "pos-1", action: "payout" }),
          })
        )
      })
    })

    it("calls remove-position API with refund action", async () => {
      ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { user: { id: "creator-1" } },
        status: "authenticated",
      })

      const fetchResponses: Record<string, unknown> = {
        "wait-time": { estimatedMinutesPerPerson: null, basedOn: 0 },
        "offer": { sent: [], received: [] },
        "position-transactions": {
          asBuyer: [{ id: "txn-1", amount: 50, status: "COMPLETED" }],
          asSeller: [],
          totalPaid: 50,
          totalReceived: 0,
          totalRefundedToBuyer: 0,
          totalRefundedAsSeller: 0,
          netAmount: -50,
          refundableCount: 1,
          refundableAmount: 50,
          downstreamBuyers: [],
        },
        "remove-position": { success: true, refundedAmount: 50, refundedCount: 1, refundFailedCount: 0 },
      }
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
        const key = Object.keys(fetchResponses).find(k => url.includes(k))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(key ? fetchResponses[key] : {}),
        })
      })

      render(
        <QueueDisplay
          lineId="line-1"
          positions={mockPositions}
          onRefresh={mockOnRefresh}
          isCreator={true}
        />
      )

      const removeButtons = screen.getAllByText("Remove")
      fireEvent.click(removeButtons[0])

      await waitFor(() => {
        expect(screen.getByText("Remove and refund $50.00")).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText("Remove and refund $50.00"))

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/lines/line-1/remove-position",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ positionId: "pos-1", action: "refund" }),
          })
        )
      })
    })

    it("closes removal modal when Cancel is clicked", async () => {
      ;(useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { user: { id: "creator-1" } },
        status: "authenticated",
      })

      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          asBuyer: [],
          asSeller: [],
          totalPaid: 0,
          totalReceived: 0,
          totalRefundedToBuyer: 0,
          totalRefundedAsSeller: 0,
          netAmount: 0,
          downstreamBuyers: [],
        }),
      })

      render(
        <QueueDisplay
          lineId="line-1"
          positions={mockPositions}
          onRefresh={mockOnRefresh}
          isCreator={true}
        />
      )

      const removeButtons = screen.getAllByText("Remove")
      fireEvent.click(removeButtons[0])

      await waitFor(() => {
        expect(screen.getByText(/Remove Alice/)).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText("Cancel"))

      await waitFor(() => {
        expect(screen.queryByText(/Remove Alice/)).not.toBeInTheDocument()
      })
    })
  })

  describe("Experience pass", () => {
    const asUser = (id: string) =>
      (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { user: { id } },
        status: "authenticated",
      })
    const pendingOffer = (amount = 15) => ({
      id: "offer-1", lineId: "line-1", fromUserId: "user-2", toUserId: "user-1",
      amount, status: "PENDING", createdAt: new Date().toISOString(),
    })
    const withToast = () => {
      const addToast = vi.fn()
      ;(useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ addToast })
      return addToast
    }

    it("tells the host to call a walk-in out at the stand", async () => {
      asUser("creator-1")
      const addToast = withToast()
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
        if (url.includes("/call-next")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ calledUser: "Alice", partySize: 2, isWalkIn: true }),
          })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ sent: [], received: [] }) })
      })

      render(<QueueDisplay lineId="line-1" positions={mockPositions} onRefresh={mockOnRefresh} isCreator={true} isRestaurant={true} />)
      fireEvent.click(screen.getAllByText("Call")[0])

      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith("Alice is a walk-in — call them out at the stand", "success")
      })
    })

    it("confirms before re-calling a party that already replied", async () => {
      asUser("creator-1")
      const positions = mockPositions.map((p) =>
        p.id === "pos-1" ? { ...p, calledAt: new Date().toISOString(), response: "RUNNING_LATE" as const, graceMinutes: 5 } : p
      )
      render(<QueueDisplay lineId="line-1" positions={positions} onRefresh={mockOnRefresh} isCreator={true} isRestaurant={true} />)

      fireEvent.click(screen.getAllByRole("button", { name: "Call again" })[0])
      expect(screen.getByText(`Call Alice again? Their "Running late" reply and extra time will be cleared.`)).toBeInTheDocument()
      expect(fetch).not.toHaveBeenCalledWith("/api/lines/line-1/call-next", expect.anything())
    })

    it("tells a called guest to ask the host to change their party size", () => {
      asUser("user-1")
      const positions = mockPositions.map((p) =>
        p.id === "pos-1" ? { ...p, calledAt: new Date().toISOString(), partySize: 3 } : p
      )
      render(<QueueDisplay lineId="line-1" positions={positions} onRefresh={mockOnRefresh} isRestaurant={true} />)

      expect(screen.getByText(/Party of 3\s*\(ask the host to change\)/)).toBeInTheDocument()
    })

    it("holds an incoming offer while swaps are paused", async () => {
      asUser("user-1")
      mockOffers([], [pendingOffer()])
      render(<QueueDisplay lineId="line-1" positions={mockPositions} onRefresh={mockOnRefresh} isPaused={true} />)

      expect(await screen.findByText("Swaps are paused. You can answer this when the line resumes.")).toBeInTheDocument()
      expect(screen.queryByText("Accept")).not.toBeInTheDocument()
    })

    it("hides Accept once the seller has been called", async () => {
      asUser("user-1")
      mockOffers([], [pendingOffer()])
      const positions = mockPositions.map((p) => (p.id === "pos-1" ? { ...p, calledAt: new Date().toISOString() } : p))
      render(<QueueDisplay lineId="line-1" positions={positions} onRefresh={mockOnRefresh} />)

      await screen.findByText(/Swap offer: \$15\.00/)
      expect(screen.queryByText("Accept")).not.toBeInTheDocument()
    })

    it("warns about payouts and seated payment on an incoming offer", async () => {
      asUser("user-2")
      mockOffers([], [{ ...pendingOffer(), fromUserId: "user-3", toUserId: "user-2" }])
      render(
        <QueueDisplay lineId="line-1" positions={mockPositions} onRefresh={mockOnRefresh} isRestaurant={true} stripeEnabled={true} hasPayoutSetup={false} />
      )

      expect(await screen.findByText(/You're paid once the buyer is seated\./)).toBeInTheDocument()
      expect(screen.getByText(/haven't connected a payout account/)).toBeInTheDocument()
    })

    it("says the payment window closed instead of '1 min' once it has", async () => {
      asUser("user-2")
      mockOffers([{
        id: "offer-1", lineId: "line-1", fromUserId: "user-2", toUserId: "user-1",
        amount: 20, status: "ACCEPTED", createdAt: new Date().toISOString(), awaitingPayment: true,
      }])
      const expired = new Date(Date.now() - 60_000).toISOString()
      const positions = mockPositions.map((p) => (p.id === "pos-1" ? { ...p, lockedUntil: expired } : p))
      render(<QueueDisplay lineId="line-1" positions={positions} onRefresh={mockOnRefresh} />)

      expect(await screen.findByText(/The payment window has closed\./)).toBeInTheDocument()
      expect(screen.queryByText(/held for you for/)).not.toBeInTheDocument()
    })

    it("prefills a raise and rejects one that isn't higher", async () => {
      asUser("user-2")
      const addToast = withToast()
      mockOffers([pendingOffer(20)].map((o) => ({ ...o, fromUserId: "user-2", toUserId: "user-1" })))
      render(<QueueDisplay lineId="line-1" positions={mockPositions} onRefresh={mockOnRefresh} />)

      fireEvent.click(await screen.findByText("Raise"))
      const input = screen.getByPlaceholderText("0.00") as HTMLInputElement
      expect(input.value).toBe("20.00")
      expect(input.min).toBe("20.01")
      expect(screen.getByText("Current offer: $20.00")).toBeInTheDocument()

      fireEvent.click(screen.getByText("Raise Offer"))
      expect(addToast).toHaveBeenCalledWith("Raise above your current $20.00", "error")
      expect(fetch).not.toHaveBeenCalledWith("/api/lines/line-1/offer", expect.objectContaining({ method: "POST" }))
    })
  })
})
