"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Application error:", error)
  }, [error])

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Card className="max-w-md w-full text-center">
        <CardContent className="py-12">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent mb-4">
            Error
          </p>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">
            Something went wrong
          </h1>
          <p className="text-ink/60 mb-8">
            An unexpected error occurred. Please try again or return to the home page.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/">
              <Button variant="secondary">Go Home</Button>
            </Link>
            <Button variant="primary" onClick={() => reset()}>
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
