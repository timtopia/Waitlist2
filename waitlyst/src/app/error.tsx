"use client"

import { startTransition, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { buttonClasses } from "@/components/ui/buttonStyles"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  useEffect(() => {
    console.error("Application error:", error)
  }, [error])

  // reset() alone re-renders the same failed server result; refresh fetches
  // it again, so a passing database blip can actually recover
  function retry() {
    startTransition(() => {
      router.refresh()
      reset()
    })
  }

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
          {error.digest && (
            // Gives support something to find in the logs
            <p className="text-sm text-ink/60 -mt-6 mb-8">
              Still stuck? Email{" "}
              <a
                href={`mailto:support@waitlyst.app?subject=${encodeURIComponent(`Error ${error.digest}`)}`}
                className="text-accent underline underline-offset-2"
              >
                support@waitlyst.app
              </a>{" "}
              with reference <span className="font-mono">{error.digest}</span>.
            </p>
          )}
          <div className="flex items-center justify-center gap-3">
            <Link href="/" className={buttonClasses({ variant: "secondary" })}>
              Go Home
            </Link>
            <Button variant="primary" onClick={retry}>
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
