"use client"

import { useState } from "react"

/**
 * A small preview under an image-URL field, so an owner who pasted a product
 * page link (not a direct image link) finds out before publishing, not after.
 */
export function ImageUrlPreview({ url }: { url: string }) {
  const trimmed = url.trim()
  // Keyed on the URL so a new link gets a fresh load/error state
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  // The field accepts http://, but saving refuses it: say so while typing
  if (/^http:\/\//i.test(trimmed)) {
    return (
      <p className="text-xs text-amber-700 mt-1" role="status">
        Use an https:// link -- images from plain http:// links can&apos;t be shown.
      </p>
    )
  }
  if (!/^https:\/\/\S+$/i.test(trimmed)) return null

  if (failedUrl === trimmed) {
    return (
      <p className="text-xs text-amber-700 mt-1" role="status">
        This link doesn&apos;t load as an image. Use a direct link to the picture (usually ending in .jpg, .png or .webp).
      </p>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- any https host, shown as-is
    <img
      src={trimmed}
      alt="Preview of the product image"
      className="mt-2 h-24 w-24 object-cover border border-rule bg-paper"
      onError={() => setFailedUrl(trimmed)}
    />
  )
}
