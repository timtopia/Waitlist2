import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { QueueDisplay } from "@/components/QueueDisplay"
import { useSession } from "next-auth/react"

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
    expect(nextUp.closest("p")).toHaveTextContent("Bob")
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
})
