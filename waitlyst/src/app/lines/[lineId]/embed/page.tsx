import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
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
        <p className="text-gray-500 text-sm">Line not found</p>
      </div>
    )
  }

  const positionCount = line._count.positions

  return (
    <EmbedWidgetClient
      lineId={line.id}
      lineName={line.name}
      productName={line.productName}
      productImage={line.productImage}
      productPrice={line.productPrice}
      positionCount={positionCount}
      maxCapacity={line.maxCapacity}
      opensAt={line.opensAt ? line.opensAt.toISOString() : null}
      closesAt={line.closesAt ? line.closesAt.toISOString() : null}
    />
  )
}
