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
      {header}
      <main className="flex-1">{children}</main>
      {footer}
    </div>
  )
}
