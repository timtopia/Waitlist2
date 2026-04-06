import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { LineDetailClient } from "./LineDetailClient"

interface Props {
  params: Promise<{ lineId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lineId } = await params

  const line = await prisma.line.findUnique({
    where: { id: lineId },
    include: {
      createdBy: { select: { name: true } },
      _count: { select: { positions: true } },
    },
  })

  if (!line) {
    return { title: "Line Not Found - Waitlyst" }
  }

  const positionCount = line._count.positions
  const capacityText = line.maxCapacity
    ? `${positionCount}/${line.maxCapacity} spots filled`
    : `${positionCount} ${positionCount === 1 ? "person" : "people"} in line`

  let statusText = ""
  const now = new Date()
  if (line.opensAt && now < new Date(line.opensAt)) {
    statusText = `Opens ${new Date(line.opensAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}`
  } else if (line.closesAt && now > new Date(line.closesAt)) {
    statusText = "Closed"
  } else if (line.maxCapacity && positionCount >= line.maxCapacity) {
    statusText = "Full"
  } else {
    statusText = "Open now"
  }

  const description = [
    line.description || `Join the queue for ${line.name}`,
    statusText,
    capacityText,
    `Created by ${line.createdBy.name || "Anonymous"}`,
  ].join(" · ")

  return {
    title: `${line.name} - Waitlyst`,
    description,
    openGraph: {
      title: `${line.name} - Waitlyst`,
      description,
      type: "website",
      siteName: "Waitlyst",
    },
    twitter: {
      card: "summary_large_image",
      title: `${line.name} - Waitlyst`,
      description,
    },
  }
}

export default async function LineDetailPage({ params }: Props) {
  const { lineId } = await params
  return <LineDetailClient lineId={lineId} />
}
