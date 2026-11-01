import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { capacityView } from "@/lib/capacity"
import { countCapacityUsed } from "@/lib/capacity-server"
import { EmbedWidgetClient } from "./EmbedWidgetClient"

export const metadata: Metadata = {
  title: "Waitlyst Widget",
  robots: { index: false, follow: false },
}

interface Props {
  params: Promise<{ lineId: string }>
}

export default async function EmbedPage({ params }: Props) {
  const { lineId } = await params

  const line = await prisma.line.findUnique({
    where: { id: lineId },
    include: {
      _count: { select: { positions: true } },
    },
  })

  if (!line) {
    return (
      <div className="flex items-center justify-center h-screen p-4">
        <p className="text-ink/60 text-sm">Line not found</p>
      </div>
    )
  }

  const { _sum } = await prisma.linePosition.aggregate({
    // Served people stay listed until cleared; they aren't waiting
    where: { lineId, fulfilled: false },
    _sum: { partySize: true },
  })
  const positionCount = _sum.partySize ?? 0
  const capacity = capacityView(line, await countCapacityUsed(line))

  return (
    <EmbedWidgetClient
      lineId={line.id}
      lineName={line.name}
      productName={line.productName}
      productImage={line.productImage}
      productPrice={line.productPrice}
      positionCount={positionCount}
      kind={line.kind}
      maxCapacity={capacity.maxCapacity}
      isFull={capacity.isFull}
      opensAt={line.opensAt ? line.opensAt.toISOString() : null}
      closesAt={line.closesAt ? line.closesAt.toISOString() : null}
      nowServing={line.nowServing}
      isActive={line.isActive}
      capacityUsed={capacity.capacityUsed}
      hideCapacity={capacity.hasCapacityLimit && capacity.maxCapacity === null}
    />
  )
}
