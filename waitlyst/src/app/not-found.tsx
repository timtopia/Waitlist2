import Link from "next/link"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Card className="max-w-md w-full text-center">
        <CardContent className="py-12">
          <p className="font-mono text-7xl tabular-nums text-accent mb-4">404</p>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">
            Page not found
          </h1>
          <p className="text-ink/60 mb-8">
            This page doesn&apos;t exist, or the line was deleted.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/browse">
              <Button variant="secondary">Browse Lines</Button>
            </Link>
            <Link href="/">
              <Button variant="primary">Go Home</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
