import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { capacityUnit, capacityUsed, capacityView, guestCount } from "@/lib/capacity"
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
      positions: { select: { partySize: true, fulfilled: true } },
    },
  })
}

type PageLine = NonNullable<Awaited<ReturnType<typeof getLine>>>

/** Drops count buyers served and cleared from the list, like the line API */
async function servedAndCleared(line: PageLine) {
  return line.kind === "RESTAURANT"
    ? 0
    : prisma.queueVisit.count({ where: { lineId: line.id, outcome: "SERVED" } })
}

function buildDescription(line: PageLine, cleared: number) {
  // Seated and served guests aren't in line any more
  const positionCount = guestCount(line.positions.filter((p) => !p.fulfilled))
  const { maxCapacity, isFull } = capacityView(line, capacityUsed(line.kind, line.positions, cleared))
  const capacityText = maxCapacity
    ? `${positionCount}/${maxCapacity} ${capacityUnit(line.kind, maxCapacity)} filled`
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
  } else if (!line.isActive) {
    statusText = "Paused"
  } else if (isFull) {
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
    return { title: "Line Not Found" }
  }

  const description = buildDescription(line, await servedAndCleared(line))

  return {
    title: line.name,
    description,
    // Private lines are reached by link only; keep them out of search results
    ...(!line.isPublic && { robots: { index: false, follow: false } }),
    openGraph: {
      title: `${line.name} - Waitlyst`,
      description,
      type: "website",
      siteName: "Waitlyst",
      ...(line.productImage && { images: [line.productImage] }),
    },
    twitter: {
      card: "summary_large_image",
      title: `${line.name} - Waitlyst`,
      description,
      ...(line.productImage && { images: [line.productImage] }),
    },
  }
}

export default async function LineDetailPage({ params }: Props) {
  const { lineId } = await params
  const line = await getLine(lineId)
  // A bad or deleted link gets the real 404 page (with somewhere to go)
  if (!line) notFound()

  // Build JSON-LD structured data, for public lines only: a private line
  // shouldn't hand search engines its details
  let jsonLd: Record<string, unknown> | null = null
  if (line.isPublic) {
    const cleared = await servedAndCleared(line)
    const description = buildDescription(line, cleared)

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
            availability: !line.isActive || capacityView(line, capacityUsed(line.kind, line.positions, cleared)).isFull
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
        ...(!line.hideCapacity && line.maxCapacity && {
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
