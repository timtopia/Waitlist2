import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { DashboardClient } from "@/app/dashboard/DashboardClient"

// Mock fetch
global.fetch = vi.fn()

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  })),
}))

// Mock clipboard API
const mockWriteText = vi.fn()
Object.defineProperty(navigator, "clipboard", {
  value: {
    writeText: mockWriteText,
  },
  writable: true,
  configurable: true,
})

const mockCreatedLines = [
  {
    id: "line-1",
    name: "Test Line 1",
    description: "A test line",
    isActive: true,
    isPublic: true,
    _count: { positions: 5 },
    frontPerson: {
      id: "pos-1",
      user: { id: "user-1", name: "Alice" },
    },
  },
  {
    id: "line-2",
    name: "Test Line 2",
    description: null,
    isActive: true,
    isPublic: false,
    _count: { positions: 0 },
    frontPerson: null,
  },
]

const mockPositions = [
  {
    id: "pos-1",
    lineId: "line-3",
    position: 2,
    askingPrice: "15.00",
    line: {
      name: "Another Line",
      _count: { positions: 10 },
    },
  },
]

describe("DashboardClient", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })
  })

  it("renders dashboard title", () => {
    render(<DashboardClient createdLines={[]} positions={[]} />)
    expect(screen.getByText("Dashboard")).toBeInTheDocument()
  })

  it("renders empty state for positions", () => {
    render(<DashboardClient createdLines={[]} positions={[]} />)
    expect(screen.getByText("You haven't joined any lines yet.")).toBeInTheDocument()
  })

  it("renders empty state for created lines", () => {
    render(<DashboardClient createdLines={[]} positions={[]} />)
    expect(screen.getByText("You haven't created any lines yet.")).toBeInTheDocument()
  })

  it("renders user positions", () => {
    render(<DashboardClient createdLines={[]} positions={mockPositions} />)
    expect(screen.getByText("Another Line")).toBeInTheDocument()
    expect(screen.getByText("#2")).toBeInTheDocument()
    expect(screen.getByText("For sale: $15.00")).toBeInTheDocument()
  })

  it("renders created lines", () => {
    render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)
    expect(screen.getByText("Test Line 1")).toBeInTheDocument()
    expect(screen.getByText("Test Line 2")).toBeInTheDocument()
    expect(screen.getByText("5 in line")).toBeInTheDocument()
    expect(screen.getByText("0 in line")).toBeInTheDocument()
  })

  it("shows public/private badges", () => {
    render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)
    expect(screen.getByText("Public")).toBeInTheDocument()
    expect(screen.getByText("Private")).toBeInTheDocument()
  })

  it("shows front person for lines with people", () => {
    render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)
    expect(screen.getByText(/Next: Alice/)).toBeInTheDocument()
  })

  it("shows Remove Front button for lines with front person", () => {
    render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)
    expect(screen.getByText("Remove Front")).toBeInTheDocument()
  })

  it("copies link to clipboard", async () => {
    render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

    const copyButtons = screen.getAllByText("Copy Link")
    fireEvent.click(copyButtons[0])

    expect(mockWriteText).toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByText("Copied!")).toBeInTheDocument()
    })
  })

  describe("Stats Modal", () => {
    it("opens stats modal when Stats button is clicked", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          totalTransactions: 10,
          completedCount: 5,
          refundedCount: 2,
          pendingSettlementCount: 3,
          totalCompleted: 150.00,
          totalRefunded: 50.00,
          pendingSettlement: 75.00,
          netRevenue: 100.00,
        }),
      })

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const statsButtons = screen.getAllByText("Stats")
      fireEvent.click(statsButtons[0])

      await waitFor(() => {
        expect(screen.getByText("Test Line 1 - Transaction Stats")).toBeInTheDocument()
      })
    })

    it("shows settled amount in stats modal", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          totalTransactions: 10,
          completedCount: 5,
          refundedCount: 2,
          pendingSettlementCount: 3,
          totalCompleted: 150.00,
          totalRefunded: 50.00,
          pendingSettlement: 75.00,
          netRevenue: 100.00,
        }),
      })

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const statsButtons = screen.getAllByText("Stats")
      fireEvent.click(statsButtons[0])

      await waitFor(() => {
        expect(screen.getByText("$150.00")).toBeInTheDocument()
        expect(screen.getByText("Settled (5)")).toBeInTheDocument()
      })
    })

    it("shows refunded amount in stats modal", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          totalTransactions: 10,
          completedCount: 5,
          refundedCount: 2,
          pendingSettlementCount: 0,
          totalCompleted: 150.00,
          totalRefunded: 50.00,
          pendingSettlement: 0,
          netRevenue: 100.00,
        }),
      })

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const statsButtons = screen.getAllByText("Stats")
      fireEvent.click(statsButtons[0])

      await waitFor(() => {
        expect(screen.getByText("$50.00")).toBeInTheDocument()
        expect(screen.getByText("Refunded (2)")).toBeInTheDocument()
      })
    })

    it("shows pending settlement when present", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          totalTransactions: 10,
          completedCount: 5,
          refundedCount: 2,
          pendingSettlementCount: 3,
          totalCompleted: 150.00,
          totalRefunded: 50.00,
          pendingSettlement: 75.00,
          netRevenue: 100.00,
        }),
      })

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const statsButtons = screen.getAllByText("Stats")
      fireEvent.click(statsButtons[0])

      await waitFor(() => {
        expect(screen.getByText("$75.00")).toBeInTheDocument()
        expect(screen.getByText("Pending Settlement (3)")).toBeInTheDocument()
        expect(screen.getByText("Settles when both parties leave")).toBeInTheDocument()
      })
    })

    it("does not show pending settlement when zero", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          totalTransactions: 10,
          completedCount: 5,
          refundedCount: 2,
          pendingSettlementCount: 0,
          totalCompleted: 150.00,
          totalRefunded: 50.00,
          pendingSettlement: 0,
          netRevenue: 100.00,
        }),
      })

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const statsButtons = screen.getAllByText("Stats")
      fireEvent.click(statsButtons[0])

      await waitFor(() => {
        expect(screen.getByText("$150.00")).toBeInTheDocument()
      })

      expect(screen.queryByText("Pending Settlement")).not.toBeInTheDocument()
    })

    it("shows net revenue in stats modal", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          totalTransactions: 10,
          completedCount: 5,
          refundedCount: 2,
          pendingSettlementCount: 0,
          totalCompleted: 150.00,
          totalRefunded: 50.00,
          pendingSettlement: 0,
          netRevenue: 100.00,
        }),
      })

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const statsButtons = screen.getAllByText("Stats")
      fireEvent.click(statsButtons[0])

      await waitFor(() => {
        expect(screen.getByText("$100.00")).toBeInTheDocument()
        expect(screen.getByText("Net Revenue (Settled)")).toBeInTheDocument()
      })
    })

    it("shows total transactions count", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          totalTransactions: 10,
          completedCount: 5,
          refundedCount: 2,
          pendingSettlementCount: 0,
          totalCompleted: 150.00,
          totalRefunded: 50.00,
          pendingSettlement: 0,
          netRevenue: 100.00,
        }),
      })

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const statsButtons = screen.getAllByText("Stats")
      fireEvent.click(statsButtons[0])

      await waitFor(() => {
        expect(screen.getByText("Total transactions: 10")).toBeInTheDocument()
      })
    })

    it("shows loading state in stats modal", async () => {
      // Use a promise that doesn't resolve immediately
      let resolvePromise: (value: unknown) => void
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve
        })
      )

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const statsButtons = screen.getAllByText("Stats")
      fireEvent.click(statsButtons[0])

      await waitFor(() => {
        expect(screen.getByText("Loading stats...")).toBeInTheDocument()
      })

      // Resolve the promise
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({
          totalTransactions: 0,
          completedCount: 0,
          refundedCount: 0,
          pendingSettlementCount: 0,
          totalCompleted: 0,
          totalRefunded: 0,
          pendingSettlement: 0,
          netRevenue: 0,
        }),
      })
    })

    it("closes stats modal when Close button is clicked", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          totalTransactions: 10,
          completedCount: 5,
          refundedCount: 2,
          pendingSettlementCount: 0,
          totalCompleted: 150.00,
          totalRefunded: 50.00,
          pendingSettlement: 0,
          netRevenue: 100.00,
        }),
      })

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const statsButtons = screen.getAllByText("Stats")
      fireEvent.click(statsButtons[0])

      await waitFor(() => {
        expect(screen.getByText("Test Line 1 - Transaction Stats")).toBeInTheDocument()
      })

      // Find and click the Close button in the modal
      const closeButton = screen.getByRole("button", { name: "Close" })
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(screen.queryByText("Test Line 1 - Transaction Stats")).not.toBeInTheDocument()
      })
    })

    it("fetches stats from correct API endpoint", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          totalTransactions: 0,
          completedCount: 0,
          refundedCount: 0,
          pendingSettlementCount: 0,
          totalCompleted: 0,
          totalRefunded: 0,
          pendingSettlement: 0,
          netRevenue: 0,
        }),
      })

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const statsButtons = screen.getAllByText("Stats")
      fireEvent.click(statsButtons[0])

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/lines/line-1/stats")
      })
    })
  })

  describe("Toggle Public/Private", () => {
    it("calls settings API when toggle is clicked", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const toggleButton = screen.getByText("Make Private")
      fireEvent.click(toggleButton)

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/lines/line-1/settings",
          expect.objectContaining({
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isPublic: false }),
          })
        )
      })
    })

    it("updates UI after toggling public/private", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const toggleButton = screen.getByText("Make Private")
      fireEvent.click(toggleButton)

      await waitFor(() => {
        expect(screen.getByText("Make Public")).toBeInTheDocument()
      })
    })
  })

  describe("Remove Front", () => {
    it("shows confirm modal before removing front person", async () => {
      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const removeButton = screen.getByText("Remove Front")
      fireEvent.click(removeButton)

      // Confirm modal should appear
      await waitFor(() => {
        expect(screen.getByText("Remove Person")).toBeInTheDocument()
      })
      expect(screen.getByText(/Remove the person at the front/)).toBeInTheDocument()

      // Clicking cancel should not call the remove-front API
      const cancelButton = screen.getByText("Cancel")
      fireEvent.click(cancelButton)
      expect(fetch).not.toHaveBeenCalledWith(
        "/api/lines/line-1/remove-front",
        expect.anything()
      )
    })

    it("calls remove-front API when confirmed", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      render(<DashboardClient createdLines={mockCreatedLines} positions={[]} />)

      const removeButton = screen.getByText("Remove Front")
      fireEvent.click(removeButton)

      // Wait for confirm modal
      await waitFor(() => {
        expect(screen.getByText("Remove Person")).toBeInTheDocument()
      })

      // Click "Remove" button in the modal to confirm
      const confirmButton = screen.getByRole("button", { name: "Remove" })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/lines/line-1/remove-front",
          expect.objectContaining({ method: "POST" })
        )
      })
    })
  })
})
