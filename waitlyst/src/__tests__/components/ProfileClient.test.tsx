import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ProfileClient } from "@/app/profile/ProfileClient"

// Mock fetch
global.fetch = vi.fn()

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock next/image
vi.mock("next/image", () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}))

const mockUser = {
  id: "user-1",
  name: "Jane Doe",
  email: "jane@example.com",
  image: "https://example.com/avatar.jpg",
  createdAt: "2025-03-15T10:00:00.000Z",
}

const mockStats = {
  linesCreated: 5,
  activePositions: 3,
  totalTransactions: 12,
  sellerBalance: 150.5,
  pendingSellerEarnings: 25.0,
  ownerBalance: 75.25,
  pendingOwnerEarnings: 10.0,
  purchaseCount: 8,
  saleCount: 4,
}

const mockTransactions = [
  {
    id: "tx-1",
    amount: 25.0,
    status: "COMPLETED",
    role: "buyer" as const,
    createdAt: "2025-04-01T14:30:00.000Z",
    settledAt: "2025-04-01T14:35:00.000Z",
  },
  {
    id: "tx-2",
    amount: 50.0,
    status: "PENDING",
    role: "seller" as const,
    createdAt: "2025-04-02T09:00:00.000Z",
    settledAt: null,
  },
  {
    id: "tx-3",
    amount: 15.0,
    status: "COMPLETED",
    role: "seller" as const,
    createdAt: "2025-04-03T11:15:00.000Z",
    settledAt: "2025-04-03T11:20:00.000Z",
  },
]

describe("ProfileClient", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: "Jane Doe" }),
    })
  })

  it("renders user name, email, and join date", () => {
    render(
      <ProfileClient
        user={mockUser}
        stats={mockStats}
        recentTransactions={mockTransactions}
      />
    )

    expect(screen.getByText("Jane Doe")).toBeInTheDocument()
    expect(screen.getByText("jane@example.com")).toBeInTheDocument()
    expect(screen.getByText(/Member since/)).toBeInTheDocument()
    expect(screen.getByText(/Mar 15, 2025/)).toBeInTheDocument()
  })

  it("renders user avatar when image is provided", () => {
    render(
      <ProfileClient
        user={mockUser}
        stats={mockStats}
        recentTransactions={mockTransactions}
      />
    )

    const avatar = screen.getByAltText("Jane Doe")
    expect(avatar).toBeInTheDocument()
    expect(avatar).toHaveAttribute("src", "https://example.com/avatar.jpg")
  })

  it("renders fallback initial when no image", () => {
    const userNoImage = { ...mockUser, image: null }
    render(
      <ProfileClient
        user={userNoImage}
        stats={mockStats}
        recentTransactions={mockTransactions}
      />
    )

    expect(screen.getByText("J")).toBeInTheDocument()
  })

  it("renders stats counts", () => {
    render(
      <ProfileClient
        user={mockUser}
        stats={mockStats}
        recentTransactions={mockTransactions}
      />
    )

    expect(screen.getByText("5 lines created")).toBeInTheDocument()
    expect(screen.getByText("3 active positions")).toBeInTheDocument()
    expect(screen.getByText("8 bought")).toBeInTheDocument()
    expect(screen.getByText("4 sold")).toBeInTheDocument()
  })

  it("renders financial summary with seller and owner balances", () => {
    render(
      <ProfileClient
        user={mockUser}
        stats={mockStats}
        recentTransactions={mockTransactions}
      />
    )

    expect(screen.getByText("$150.50")).toBeInTheDocument()
    expect(screen.getByText("Seller Balance")).toBeInTheDocument()
    expect(screen.getByText("$75.25")).toBeInTheDocument()
    expect(screen.getByText("Owner Balance")).toBeInTheDocument()
  })

  it("renders pending earnings when greater than zero", () => {
    render(
      <ProfileClient
        user={mockUser}
        stats={mockStats}
        recentTransactions={mockTransactions}
      />
    )

    expect(screen.getByText("+$25.00 pending")).toBeInTheDocument()
    expect(screen.getByText("+$10.00 pending")).toBeInTheDocument()
  })

  it("does not render pending earnings when zero", () => {
    const statsNoPending = {
      ...mockStats,
      pendingSellerEarnings: 0,
      pendingOwnerEarnings: 0,
    }
    render(
      <ProfileClient
        user={mockUser}
        stats={statsNoPending}
        recentTransactions={mockTransactions}
      />
    )

    expect(screen.queryByText(/pending/)).not.toBeInTheDocument()
  })

  it("renders transaction history with amounts and statuses", () => {
    render(
      <ProfileClient
        user={mockUser}
        stats={mockStats}
        recentTransactions={mockTransactions}
      />
    )

    expect(
      screen.getByText(`Recent Transactions (${mockStats.totalTransactions} total)`)
    ).toBeInTheDocument()

    // Buyer transaction shows negative amount
    expect(screen.getByText("-$25.00")).toBeInTheDocument()
    expect(screen.getByText("Bought position")).toBeInTheDocument()

    // Seller transactions show positive amounts
    expect(screen.getByText("+$50.00")).toBeInTheDocument()
    expect(screen.getByText("+$15.00")).toBeInTheDocument()
    const soldLabels = screen.getAllByText("Sold position")
    expect(soldLabels).toHaveLength(2)

    // Statuses are displayed
    const completedBadges = screen.getAllByText("COMPLETED")
    expect(completedBadges).toHaveLength(2)
    expect(screen.getByText("PENDING")).toBeInTheDocument()
  })

  it("renders empty transaction state", () => {
    render(
      <ProfileClient
        user={mockUser}
        stats={{ ...mockStats, totalTransactions: 0 }}
        recentTransactions={[]}
      />
    )

    expect(screen.getByText("No transactions yet.")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Buy or sell a position in a line to see your transaction history here."
      )
    ).toBeInTheDocument()
  })

  describe("Profile name editing", () => {
    it("shows edit input when pencil icon is clicked", () => {
      render(
        <ProfileClient
          user={mockUser}
          stats={mockStats}
          recentTransactions={mockTransactions}
        />
      )

      const editButton = screen.getByTitle("Edit name")
      fireEvent.click(editButton)

      const input = screen.getByDisplayValue("Jane Doe")
      expect(input).toBeInTheDocument()
      expect(screen.getByTitle("Save")).toBeInTheDocument()
      expect(screen.getByTitle("Cancel")).toBeInTheDocument()
    })

    it("saves name by calling PATCH /api/user", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ name: "New Name" }),
      })

      render(
        <ProfileClient
          user={mockUser}
          stats={mockStats}
          recentTransactions={mockTransactions}
        />
      )

      // Enter edit mode
      fireEvent.click(screen.getByTitle("Edit name"))

      // Change the name
      const input = screen.getByDisplayValue("Jane Doe")
      fireEvent.change(input, { target: { value: "New Name" } })

      // Click save
      fireEvent.click(screen.getByTitle("Save"))

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/user", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "New Name" }),
        })
      })

      // Name should be updated in the UI
      await waitFor(() => {
        expect(screen.getByText("New Name")).toBeInTheDocument()
      })
    })

    it("reverts to original name when cancel is clicked", () => {
      render(
        <ProfileClient
          user={mockUser}
          stats={mockStats}
          recentTransactions={mockTransactions}
        />
      )

      // Enter edit mode
      fireEvent.click(screen.getByTitle("Edit name"))

      // Change the name
      const input = screen.getByDisplayValue("Jane Doe")
      fireEvent.change(input, { target: { value: "Something Else" } })

      // Click cancel
      fireEvent.click(screen.getByTitle("Cancel"))

      // Should show the original name, not the edited value
      expect(screen.getByText("Jane Doe")).toBeInTheDocument()
      expect(screen.queryByDisplayValue("Something Else")).not.toBeInTheDocument()
    })

    it("shows error when saving empty name", async () => {
      render(
        <ProfileClient
          user={mockUser}
          stats={mockStats}
          recentTransactions={mockTransactions}
        />
      )

      // Enter edit mode
      fireEvent.click(screen.getByTitle("Edit name"))

      // Clear the name
      const input = screen.getByDisplayValue("Jane Doe")
      fireEvent.change(input, { target: { value: "" } })

      // Click save
      fireEvent.click(screen.getByTitle("Save"))

      // Should show client-side validation error
      await waitFor(() => {
        expect(
          screen.getByText("Name must be between 1 and 50 characters")
        ).toBeInTheDocument()
      })

      // Should not have called fetch
      expect(fetch).not.toHaveBeenCalled()
    })

    it("shows error from API response on save failure", async () => {
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Name already taken" }),
      })

      render(
        <ProfileClient
          user={mockUser}
          stats={mockStats}
          recentTransactions={mockTransactions}
        />
      )

      // Enter edit mode
      fireEvent.click(screen.getByTitle("Edit name"))

      // Change the name
      const input = screen.getByDisplayValue("Jane Doe")
      fireEvent.change(input, { target: { value: "Taken Name" } })

      // Click save
      fireEvent.click(screen.getByTitle("Save"))

      await waitFor(() => {
        expect(screen.getByText("Name already taken")).toBeInTheDocument()
      })
    })

    it("displays Anonymous when user has no name", () => {
      const userNoName = { ...mockUser, name: null }
      render(
        <ProfileClient
          user={userNoName}
          stats={mockStats}
          recentTransactions={mockTransactions}
        />
      )

      expect(screen.getByText("Anonymous")).toBeInTheDocument()
    })
  })
})
