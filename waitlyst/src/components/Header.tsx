"use client"

import Link from "next/link"
import Image from "next/image"
import { useSession, signOut } from "next-auth/react"
import { buttonClasses } from "./ui/buttonStyles"
import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

export function Header() {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const accountButtonRef = useRef<HTMLButtonElement>(null)
  // The sign-in page explains Google sign-in and the terms, then comes back here
  const signInHref = `/signin?callbackUrl=${encodeURIComponent(pathname || "/")}`
  const router = useRouter()
  // Read the query at click time (browse filters live in the URL) without
  // useSearchParams, which would need a Suspense boundary in the root layout
  const goToSignIn = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    router.push(`/signin?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`)
  }

  // The account menu used to stay open until its button was clicked again
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false)
        // Keyboard users land back where they opened it
        accountButtonRef.current?.focus()
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [menuOpen])

  // Following a link (or Back) used to leave the mobile menu covering the new page
  const [menuPath, setMenuPath] = useState(pathname)
  if (menuPath !== pathname) {
    setMenuPath(pathname)
    setMobileMenuOpen(false)
    setMenuOpen(false)
  }

  useEffect(() => {
    if (!mobileMenuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [mobileMenuOpen])

  // Signing out on an account-only page used to bounce straight to
  // "Sign in to continue to your dashboard"; send those people home instead
  const handleSignOut = () => {
    const accountOnly =
      /^\/(dashboard|profile)(\/|$)/.test(pathname ?? "") ||
      /^\/lines\/(new$|[^/]+\/(edit|analytics|settlement))/.test(pathname ?? "")
    signOut(accountOnly ? { redirectTo: "/" } : undefined)
  }

  // Show visitors where they are
  const isCurrent = (href: string) => pathname === href || !!pathname?.startsWith(`${href}/`)
  const desktopLink = (href: string) =>
    `font-mono text-xs uppercase tracking-widest pb-0.5 border-b-2 ${
      isCurrent(href) ? "border-accent text-ink" : "border-transparent text-ink/60 hover:text-ink"
    }`

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
              className={desktopLink("/browse")}
              aria-current={isCurrent("/browse") ? "page" : undefined}
            >
              Browse
            </Link>
            {session && (
              <>
                <Link
                  href="/dashboard"
                  className={desktopLink("/dashboard")}
                  aria-current={isCurrent("/dashboard") ? "page" : undefined}
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
                <div
                  className="relative hidden md:block"
                  ref={accountMenuRef}
                  // Tabbing out of the menu closes it instead of leaving it over the page
                  onBlur={(e) => {
                    const to = e.relatedTarget as Node | null
                    if (menuOpen && to && !e.currentTarget.contains(to)) setMenuOpen(false)
                  }}
                >
                  {/* A disclosure of plain links, not an ARIA menu */}
                  <button
                    ref={accountButtonRef}
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="flex items-center space-x-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    aria-label="Account menu"
                    aria-controls="account-menu"
                    aria-expanded={menuOpen}
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
                    <div id="account-menu" className="absolute right-0 mt-2 w-48 bg-white py-1 z-50 border border-ink">
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
                        onClick={handleSignOut}
                        className="block w-full text-left px-4 py-2 text-sm text-ink/70 hover:bg-paper"
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <span className="hidden md:inline-flex">
                <Link href={signInHref} onClick={goToSignIn} className={buttonClasses({ size: "sm" })}>
                  Sign in with Google
                </Link>
              </span>
            )}

            {/* Mobile hamburger button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden flex items-center justify-center w-11 h-11 text-ink/60 hover:text-ink hover:bg-ink/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
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
        <div className="md:hidden border-t border-rule bg-paper" id="mobile-menu">
          <nav className="px-4 py-2 space-y-1">
            <Link
              href="/browse"
              aria-current={isCurrent("/browse") ? "page" : undefined}
              className="block px-3 py-3 font-mono text-sm uppercase tracking-widest text-ink/70 hover:text-ink aria-[current=page]:text-ink aria-[current=page]:border-l-2 aria-[current=page]:border-accent"
              onClick={() => setMobileMenuOpen(false)}
            >
              Browse
            </Link>
            {session && (
              <Link
                href="/dashboard"
                aria-current={isCurrent("/dashboard") ? "page" : undefined}
                className="block px-3 py-3 font-mono text-sm uppercase tracking-widest text-ink/70 hover:text-ink aria-[current=page]:text-ink aria-[current=page]:border-l-2 aria-[current=page]:border-accent"
                onClick={() => setMobileMenuOpen(false)}
              >
                Dashboard
              </Link>
            )}
            {session && (
              <Link
                href="/profile"
                aria-current={isCurrent("/profile") ? "page" : undefined}
                className="block px-3 py-3 font-mono text-sm uppercase tracking-widest text-ink/70 hover:text-ink aria-[current=page]:text-ink aria-[current=page]:border-l-2 aria-[current=page]:border-accent"
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
                      // The name is right beside it; don't read it twice
                      alt=""
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
                    handleSignOut()
                  }}
                  className="px-3 py-2 text-sm font-medium text-ink/60 hover:text-ink hover:bg-ink/5"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link href={signInHref} onClick={(e) => { setMobileMenuOpen(false); goToSignIn(e) }} className={buttonClasses({ className: "w-full" })}>
                Sign in with Google
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
