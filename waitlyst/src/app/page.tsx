import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { StatsBar } from "@/components/StatsBar"

export const revalidate = 60 // Cache landing page for 60 seconds

const steps = [
  {
    n: "01",
    title: "Create a line",
    body: "Set up a virtual line for your restaurant, shop, product drop, or event. Put a QR code by the door or share one link.",
  },
  {
    n: "02",
    title: "People take a number",
    body: "Everyone who joins gets a numbered spot and can wait wherever they like. The line keeps itself up to date while you wait, so there's no need to refresh.",
  },
  {
    n: "03",
    title: "You call them in",
    body: "Call the next person with one tap and they get a heads-up that it's their turn. If you allow it, people can buy or sell a spot with the person beside them, at a price you cap.",
  },
]

const useCases = [
  ["Restaurants", "Put walk-ins on a waitlist so they can grab a drink down the street instead of crowding your doorway."],
  ["Product drops", "Queue up before the release goes live. Spots can change hands at a price you cap."],
  ["Shops & services", "Barbers, salons, repair counters, pickup windows: anywhere people wait their turn."],
  ["Pop-ups & events", "Tastings, openings, signings. Cap the line and open it on a schedule."],
]

const features = [
  ["Scheduled lines", "Open and close times with live countdowns"],
  ["Live updates", "Joins, leaves, and trades show up within seconds"],
  ["Turn alerts", "Guests get a heads-up when it's their turn"],
  ["Capacity limits", "Cap the line and show how full it is"],
  ["Paid swaps", "Let people trade spots through Stripe, with an optional cut for you"],
  ["Owner controls", "Call next, remove no-shows, pause the line"],
]

export default async function HomePage() {
  const [session, activeLines, peopleInQueues, swapsCompleted] = await Promise.all([
    auth(),
    prisma.line.count({ where: { isActive: true } }),
    prisma.linePosition.count({ where: { fulfilled: false } }),
    prisma.transaction.count({ where: { status: "COMPLETED" } }),
  ])

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-rule">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent mb-6">
            Now serving — anyone with a link
          </p>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight leading-[0.95] max-w-4xl">
            Wait anywhere.
            <br />
            Keep your place.
          </h1>
          <p className="mt-8 text-lg sm:text-xl text-ink/70 max-w-2xl leading-relaxed">
            Waitlyst runs virtual lines for restaurants, shops, product drops,
            and events. People join from their phone, see exactly where they
            stand, and can trade spots with the person beside them when the
            owner allows it.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3">
            {session ? (
              <>
                <Link
                  href="/lines/new"
                  className="inline-flex items-center justify-center px-8 py-3.5 bg-ink text-paper font-medium hover:bg-accent transition-colors"
                >
                  Start a line
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center px-8 py-3.5 border border-ink font-medium hover:bg-ink hover:text-paper transition-colors"
                >
                  My dashboard
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/browse"
                  className="inline-flex items-center justify-center px-8 py-3.5 bg-ink text-paper font-medium hover:bg-accent transition-colors"
                >
                  Browse open lines
                </Link>
                <Link
                  href="/lines/new"
                  className="inline-flex items-center justify-center px-8 py-3.5 border border-ink font-medium hover:bg-ink hover:text-paper transition-colors"
                >
                  Start a line
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Live counters */}
      <StatsBar
        activeLines={activeLines}
        peopleInQueues={peopleInQueues}
        swapsCompleted={swapsCompleted}
      />

      {/* How it works — numbered ledger */}
      <section id="how-it-works" className="border-b border-rule">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-ink/60 mb-10">
            How it works
          </h2>
          <div className="divide-y divide-rule border-t border-b border-rule">
            {steps.map((step) => (
              <div
                key={step.n}
                className="grid grid-cols-1 sm:grid-cols-12 gap-4 sm:gap-8 py-8 sm:py-10"
              >
                <div className="sm:col-span-2">
                  <span className="font-mono text-4xl sm:text-5xl text-accent tabular-nums">
                    {step.n}
                  </span>
                </div>
                <div className="sm:col-span-4">
                  <h3 className="text-xl sm:text-2xl font-semibold tracking-tight">
                    {step.title}
                  </h3>
                </div>
                <div className="sm:col-span-6">
                  <p className="text-ink/70 leading-relaxed">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="border-b border-rule">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-ink/60 mb-10">
            Built for
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 border-t border-l border-rule">
            {useCases.map(([title, body]) => (
              <div key={title} className="border-b border-r border-rule p-8 sm:p-10">
                <h3 className="text-lg font-semibold tracking-tight mb-2">{title}</h3>
                <p className="text-sm text-ink/60 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-b border-rule">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-ink/60 mb-10">
            What&apos;s in the box
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-8">
            {features.map(([title, body]) => (
              <div key={title} className="border-t border-ink pt-4">
                <dt className="font-semibold">{title}</dt>
                <dd className="text-sm text-ink/60 mt-1">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* CTA */}
      {!session && (
        <section className="bg-ink text-paper">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-8">
            <div>
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                Take a number.
              </h2>
              <p className="mt-2 text-paper/60">
                Start your own line in about a minute. Joining one? Just open the link you were given.
              </p>
            </div>
            <Link
              href="/lines/new"
              className="inline-flex items-center justify-center px-8 py-3.5 bg-paper text-ink font-medium hover:bg-accent hover:text-white transition-colors shrink-0"
            >
              Get started
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
