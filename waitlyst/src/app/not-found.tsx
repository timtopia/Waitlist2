import type { Metadata } from "next"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/Card"
import { buttonClasses } from "@/components/ui/buttonStyles"

// The tab used to read the generic site title, not that something was missing
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
}

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Card className="max-w-md w-full text-center">
        <CardContent className="py-12">
          <p className="font-mono text-7xl tabular-nums text-accent mb-4">404</p>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">
            Page not found
          </h1>
          <p className="text-ink/60 mb-2">
            This page doesn&apos;t exist, or the line was deleted.
          </p>
          <p className="text-sm text-ink/60 mb-8">
            Scanned a QR code or followed a link? Check it was copied in full,
            or ask whoever shared it for a fresh one.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/browse" className={buttonClasses({ variant: "secondary" })}>
              Browse Lines
            </Link>
            <Link href="/" className={buttonClasses({ variant: "primary" })}>
              Go Home
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
