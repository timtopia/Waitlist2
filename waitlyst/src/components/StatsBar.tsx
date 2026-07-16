import { AnimatedStat } from "./AnimatedStat"

interface StatsBarProps {
  activeLines: number
  peopleInQueues: number
  swapsCompleted: number
}

export function StatsBar({ activeLines, peopleInQueues, swapsCompleted }: StatsBarProps) {
  // Hide entirely if there are no stats to show
  if (activeLines === 0 && peopleInQueues === 0 && swapsCompleted === 0) {
    return null
  }

  return (
    <section className="border-b border-rule">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-rule">
          <AnimatedStat value={activeLines} label="Active lines" />
          <AnimatedStat value={peopleInQueues} label="People in queues" />
          <AnimatedStat value={swapsCompleted} label="Trades completed" />
        </div>
      </div>
    </section>
  )
}
