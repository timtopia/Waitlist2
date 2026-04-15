import type { MetadataRoute } from "next"

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://waitlyst.app"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard",
        "/profile",
        "/lines/*/edit",
        "/lines/*/settlement",
        "/lines/*/embed",
      ],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
