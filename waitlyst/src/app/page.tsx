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
    take: 6,
  })

  return (
    <div>
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              Skip the wait.
              <br />
              <span className="text-blue-200">Trade your place in line.</span>
            </h1>
            <p className="text-lg sm:text-xl text-blue-100 mb-8 max-w-2xl">
              Waitlyst lets you create virtual queues for events, drops, and services.
              People join your line, and they can buy or sell their position to others.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              {session ? (
                <>
                  <Link href="/lines/new">
                    <button className="w-full sm:w-auto px-8 py-3 text-base font-semibold rounded-lg bg-white text-blue-700 hover:bg-blue-50 transition-colors">
                      Create a Line
                    </button>
                  </Link>
                  <Link href="/dashboard">
                    <button className="w-full sm:w-auto px-8 py-3 text-base font-semibold rounded-lg border border-blue-300 text-white hover:bg-blue-600 transition-colors">
                      My Dashboard
                    </button>
                  </Link>
                </>
              ) : (
                <>
                  <Link href="#browse">
                    <button className="w-full sm:w-auto px-8 py-3 text-base font-semibold rounded-lg bg-white text-blue-700 hover:bg-blue-50 transition-colors">
                      Browse Lines
                    </button>
                  </Link>
                  <Link href="#how-it-works">
                    <button className="w-full sm:w-auto px-8 py-3 text-base font-semibold rounded-lg border border-blue-300 text-white hover:bg-blue-600 transition-colors">
                      How It Works
                    </button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="bg-white py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">How It Works</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Whether you're organizing an event or waiting in line, Waitlyst makes queuing fair, transparent, and flexible.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
            {/* Step 1 */}
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Create a Line</h3>
              <p className="text-gray-600">
                Set up a virtual queue for your event, product drop, or service.
                Set a capacity limit and schedule when it opens.
              </p>
            </div>

            {/* Step 2 */}
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">People Join</h3>
              <p className="text-gray-600">
                Share your line link. People join and get a position.
                Real-time updates keep everyone informed as the line moves.
              </p>
            </div>

            {/* Step 3 */}
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Trade Positions</h3>
              <p className="text-gray-600">
                Don't want to wait? Buy the spot ahead of you.
                Want to leave? Sell your position and earn money.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">Built For</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-xl p-6 border border-gray-200">
              <div className="text-3xl mb-3">🎵</div>
              <h3 className="font-semibold text-gray-900 mb-2">Concert Presales</h3>
              <p className="text-sm text-gray-600">
                Schedule a line that opens when tickets go live. Fans queue up and trade spots.
              </p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-gray-200">
              <div className="text-3xl mb-3">👟</div>
              <h3 className="font-semibold text-gray-900 mb-2">Product Drops</h3>
              <p className="text-sm text-gray-600">
                Limited sneakers, merch, or collectibles. Set a capacity and let the line fill up.
              </p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-gray-200">
              <div className="text-3xl mb-3">🍽️</div>
              <h3 className="font-semibold text-gray-900 mb-2">Restaurant Waitlists</h3>
              <p className="text-sm text-gray-600">
                No more standing around. Join the line remotely and get notified when you're up.
              </p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-gray-200">
              <div className="text-3xl mb-3">🎟️</div>
              <h3 className="font-semibold text-gray-900 mb-2">Event Registration</h3>
              <p className="text-sm text-gray-600">
                Limited capacity workshops, meetups, or classes. First come, first served — fairly.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-white py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">Features</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8 max-w-4xl mx-auto">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Scheduled Lines</h3>
                <p className="text-sm text-gray-600">Set open/close times with live countdown timers</p>
              </div>
            </div>
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Real-Time Updates</h3>
                <p className="text-sm text-gray-600">See joins, leaves, and swaps as they happen</p>
              </div>
            </div>
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Browser Notifications</h3>
                <p className="text-sm text-gray-600">Get notified when your position changes</p>
              </div>
            </div>
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Capacity Limits</h3>
                <p className="text-sm text-gray-600">Set max spots with a visual fill-up bar</p>
              </div>
            </div>
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Shareable Links</h3>
                <p className="text-sm text-gray-600">Rich previews when shared on social media</p>
              </div>
            </div>
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0 w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Owner Controls</h3>
                <p className="text-sm text-gray-600">Remove people, view stats, manage your queue</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Browse Lines */}
      <section id="browse" className="bg-gray-50 py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">Active Lines</h2>
            {session && (
              <Link href="/lines/new">
                <Button>Create a Line</Button>
              </Link>
            )}
          </div>

          {lines.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
              <p className="text-gray-500 mb-4">No active lines yet. Be the first!</p>
              {session ? (
                <Link href="/lines/new">
                  <Button>Create the First Line</Button>
                </Link>
              ) : (
                <p className="text-sm text-gray-400">Sign in to create a line</p>
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
                    opensAt: line.opensAt?.toISOString() || null,
                    closesAt: line.closesAt?.toISOString() || null,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      {!session && (
        <section className="bg-blue-600 py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl font-bold text-white mb-4">
              Ready to get started?
            </h2>
            <p className="text-blue-100 mb-8 text-lg">
              Sign in with Google to create your first line or join an existing one.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
