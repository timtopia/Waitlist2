import "@testing-library/jest-dom"
import { vi } from "vitest"

// Mock window.alert and window.confirm
window.alert = vi.fn()
window.confirm = vi.fn().mockReturnValue(true)

// Mock next-auth
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: "test-user-id", name: "Test User" } },
    status: "authenticated",
  })),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  })),
  redirect: vi.fn(),
}))
