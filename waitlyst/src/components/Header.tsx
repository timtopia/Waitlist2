"use client"

import Link from "next/link"
import Image from "next/image"
import { useSession, signIn, signOut } from "next-auth/react"
import { Button } from "./ui/Button"
import { useState } from "react"

export function Header() {
  const { data: session, status } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="bg-paper border-b border-ink">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-accent inline-block" aria-hidden />
              <span className="font-mono text-lg font-semibold tracking-tight uppercase">Waitlyst</span>
            </Link>

          <nav className="hidden md:flex items-center gap-6">
            <Link
              href="/browse"
              className="font-mono text-xs uppercase tracking-widest text-ink/60 hover:text-ink"
            >
              Browse
            </Link>
            {session && (
              <>
                <Link
                  href="/dashboard"
                  className="font-mono text-xs uppercase tracking-widest text-ink/60 hover:text-ink"
                >
                  Dashboard
                </Link>
              </>
            )}
          </nav>
          </div>

          <div className="flex items-center space-x-4">
            {status === "loading" ? (
              <div className="w-8 h-8 bg-ink/10 animate-pulse" />
            ) : session ? (
              <>
                {/* Desktop profile dropdown */}
                <div className="relative hidden md:block">
                  <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="flex items-center space-x-2 focus:outline-none"
                  >
                    {session.user?.image ? (
                      <Image
                        src={session.user.image}
                        alt={session.user.name || "User"}
                        width={32}
                        height={32}
                      />
                    ) : (
                      <div className="w-8 h-8 bg-ink flex items-center justify-center text-paper text-sm font-medium">
                        {session.user?.name?.[0] || "U"}
                      </div>
                    )}
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-white py-1 z-50 border border-ink">
                      <div className="px-4 py-2 border-b border-rule">
                        <p className="text-sm font-medium text-ink">{session.user?.name}</p>
                        <p className="text-sm text-ink/60 truncate">{session.user?.email}</p>
                      </div>
                      <Link
                        href="/profile"
                        className="block px-4 py-2 text-sm text-ink/70 hover:bg-paper"
                        onClick={() => setMenuOpen(false)}
                      >
                        Profile
                      </Link>
                      <button
                        onClick={() => signOut()}
                        className="block w-full text-left px-4 py-2 text-sm text-ink/70 hover:bg-paper"
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <Button onClick={() => signIn("google")} size="sm" className="hidden md:inline-flex">
                Sign in with Google
              </Button>
            )}

            {/* Mobile hamburger button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden flex items-center justify-center w-11 h-11 text-ink/60 hover:text-ink hover:bg-ink/5 focus:outline-none"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-rule bg-paper">
          <nav className="px-4 py-2 space-y-1">
            <Link
              href="/browse"
              className="block px-3 py-3 font-mono text-sm uppercase tracking-widest text-ink/70 hover:text-ink"
              onClick={() => setMobileMenuOpen(false)}
            >
              Browse
            </Link>
            {session && (
              <Link
                href="/dashboard"
                className="block px-3 py-3 font-mono text-sm uppercase tracking-widest text-ink/70 hover:text-ink"
                onClick={() => setMobileMenuOpen(false)}
              >
                Dashboard
              </Link>
            )}
            {session && (
              <Link
                href="/profile"
                className="block px-3 py-3 font-mono text-sm uppercase tracking-widest text-ink/70 hover:text-ink"
                onClick={() => setMobileMenuOpen(false)}
              >
                Profile
              </Link>
            )}
          </nav>
          <div className="border-t border-rule px-4 py-3">
            {status === "loading" ? (
              <div className="w-8 h-8 bg-ink/10 animate-pulse" />
            ) : session ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {session.user?.image ? (
                    <Image
                      src={session.user.image}
                      alt={session.user.name || "User"}
                      width={36}
                      height={36}
                    />
                  ) : (
                    <div className="w-9 h-9 bg-ink flex items-center justify-center text-paper text-sm font-medium">
                      {session.user?.name?.[0] || "U"}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-ink">{session.user?.name}</p>
                    <p className="text-xs text-ink/60 truncate max-w-[180px]">{session.user?.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false)
                    signOut()
                  }}
                  className="px-3 py-2 text-sm font-medium text-ink/60 hover:text-ink hover:bg-ink/5"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Button onClick={() => { setMobileMenuOpen(false); signIn("google") }} className="w-full">
                Sign in with Google
              </Button>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
