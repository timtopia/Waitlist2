import type { MetadataRoute } from "next"
import { prisma } from "@/lib/prisma"

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://waitlyst.app"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/browse`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ]

  const lines = await prisma.line.findMany({
    where: { isPublic: true, isActive: true },
    select: { id: true, updatedAt: true },
  })

  const linePages: MetadataRoute.Sitemap = lines.map((line) => ({
    url: `${BASE_URL}/lines/${line.id}`,
    lastModified: line.updatedAt,
    changeFrequency: "hourly",
    priority: 0.7,
  }))

  return [...staticPages, ...linePages]
}
