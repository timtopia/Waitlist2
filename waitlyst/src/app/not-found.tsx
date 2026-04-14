import Link from "next/link"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Card className="max-w-md w-full text-center">
        <CardContent className="py-12">
          <p className="text-7xl font-bold text-blue-600 mb-4">404</p>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">
            Page not found
          </h1>
          <p className="text-gray-500 mb-8">
            The line you&apos;re looking for doesn&apos;t exist or has been deleted.
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
