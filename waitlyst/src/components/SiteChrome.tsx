"use client"

import { usePathname } from "next/navigation"

/**
 * The site header and footer, except on the embeddable widget: it lives in
 * an iframe on other people's sites and must be just the widget.
 */
export function SiteChrome({
  header,
  footer,
  children,
}: {
  header: React.ReactNode
  footer: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  if (pathname?.endsWith("/embed")) return <>{children}</>
  return (
    <div className="flex flex-col min-h-screen">
      {/* Lets keyboard users jump past the header nav */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-ink focus:text-paper focus:px-4 focus:py-2 focus:text-sm">
        Skip to content
      </a>
      {header}
      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">{children}</main>
      {footer}
    </div>
  )
}
