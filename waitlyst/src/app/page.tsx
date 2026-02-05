import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { LineCard } from "@/components/LineCard"
import { Button } from "@/components/ui/Button"
import { auth } from "@/auth"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const session = await auth()
  const lines = await prisma.line.findMany({
    where: { isActive: true, isPublic: true },
    include: {
      createdBy: { select: { name: true, image: true } },
      _count: { select: { positions: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Welcome to Waitlyst
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
          Create virtual queues, join lines, and trade your position with others.
          Skip the wait by buying a better spot, or earn money by selling yours.
        </p>
        {session ? (
          <Link href="/lines/new">
            <Button size="lg">Create a New Line</Button>
          </Link>
        ) : (
          <p className="text-gray-500">Sign in to create your own line</p>
        )}
      </div>

      {/* Lines Grid */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">Active Lines</h2>
        {lines.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <p className="text-gray-500 mb-4">No active lines yet.</p>
            {session && (
              <Link href="/lines/new">
                <Button>Create the first line</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {lines.map((line) => (
              <LineCard
                key={line.id}
                line={{
                  ...line,
                  createdAt: line.createdAt.toISOString(),
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
