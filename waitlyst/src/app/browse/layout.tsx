import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Browse Lines",
  // Shown in search results and link previews instead of the site-wide blurb
  description:
    "Public virtual lines you can join right now: restaurants, shops, product drops, and events. Take a number from your phone and wait anywhere.",
  alternates: { canonical: "/browse" },
  // Without this a shared browse link previews as the generic home page
  openGraph: {
    title: "Browse Lines - Waitlyst",
    description: "Public virtual lines you can join right now: restaurants, shops, product drops, and events.",
    type: "website",
    siteName: "Waitlyst",
    images: ["/opengraph-image"],
  },
}

export default function BrowseLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
