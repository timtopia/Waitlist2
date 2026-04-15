import { AnimatedStat } from "./AnimatedStat"

interface StatsBarProps {
  activeLines: number
  peopleInQueues: number
  positionsTraded: number
}

export function StatsBar({ activeLines, peopleInQueues, positionsTraded }: StatsBarProps) {
  // Hide entirely if there are no stats to show
  if (activeLines === 0 && peopleInQueues === 0 && positionsTraded === 0) {
    return null
  }

  return (
    <section className="bg-gray-50 border-b border-gray-200 py-12 sm:py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-12">
          <AnimatedStat value={activeLines} label="Active Lines" />
          <AnimatedStat value={peopleInQueues} label="People in Queues" />
          <AnimatedStat value={positionsTraded} label="Positions Traded" />
        </div>
      </div>
    </section>
  )
}
