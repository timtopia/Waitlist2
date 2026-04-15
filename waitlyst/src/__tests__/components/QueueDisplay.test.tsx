import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
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
      expect(screen.getByText(/Waiting for response/)).toBeInTheDocument()
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

      await waitFor(() => {
        expect(screen.getByText("Payout (Keep Transactions Final)")).toBeInTheDocument()
      })
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
        expect(screen.getByText("Refund ($50.00 to buyer)")).toBeInTheDocument()
      })
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
        expect(screen.getByText("Payout (Keep Transactions Final)")).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText("Payout (Keep Transactions Final)"))

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
          downstreamBuyers: [],
        },
        "remove-position": { success: true, refundedAmount: 50, refundedCount: 1 },
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
        expect(screen.getByText("Refund ($50.00 to buyer)")).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText("Refund ($50.00 to buyer)"))

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
