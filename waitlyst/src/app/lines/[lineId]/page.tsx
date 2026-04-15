import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { LineDetailClient } from "./LineDetailClient"

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://waitlyst.app"

interface Props {
  params: Promise<{ lineId: string }>
}

async function getLine(lineId: string) {
  return prisma.line.findUnique({
    where: { id: lineId },
    include: {
      createdBy: { select: { name: true } },
      _count: { select: { positions: true } },
    },
  })
}

function buildDescription(line: NonNullable<Awaited<ReturnType<typeof getLine>>>) {
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

  return [
    line.description || `Join the queue for ${line.name}`,
    statusText,
    capacityText,
    `Created by ${line.createdBy.name || "Anonymous"}`,
  ].join(" · ")
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lineId } = await params
  const line = await getLine(lineId)

  if (!line) {
    return { title: "Line Not Found - Waitlyst" }
  }

  const description = buildDescription(line)

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
  const line = await getLine(lineId)

  // Build JSON-LD structured data
  let jsonLd: Record<string, unknown> | null = null
  if (line) {
    const description = buildDescription(line)

    if (line.productName || line.productPrice) {
      // Product-style structured data
      jsonLd = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: line.productName || line.name,
        description: line.description || `Queue for ${line.name}`,
        url: `${BASE_URL}/lines/${lineId}`,
        ...(line.productImage && { image: line.productImage }),
        ...(line.productPrice && {
          offers: {
            "@type": "Offer",
            price: line.productPrice,
            priceCurrency: "USD",
            availability: line.maxCapacity && line._count.positions >= line.maxCapacity
              ? "https://schema.org/SoldOut"
              : "https://schema.org/InStock",
          },
        }),
        brand: {
          "@type": "Organization",
          name: line.createdBy.name || "Waitlyst",
        },
      }
    } else {
      // Event-style structured data
      jsonLd = {
        "@context": "https://schema.org",
        "@type": "Event",
        name: line.name,
        description: description,
        url: `${BASE_URL}/lines/${lineId}`,
        organizer: {
          "@type": "Person",
          name: line.createdBy.name || "Anonymous",
        },
        eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
        ...(line.opensAt && { startDate: new Date(line.opensAt).toISOString() }),
        ...(line.closesAt && { endDate: new Date(line.closesAt).toISOString() }),
        ...(line.maxCapacity && {
          maximumAttendeeCapacity: line.maxCapacity,
        }),
      }
    }
  }

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <LineDetailClient lineId={lineId} />
    </>
  )
}
