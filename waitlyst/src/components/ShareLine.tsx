"use client"

import { useState, useRef, useCallback } from "react"
import { Button } from "./ui/Button"

interface ShareLineProps {
  lineId: string
  lineName: string
}

export function ShareLine({ lineId, lineName }: ShareLineProps) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [showEmbed, setShowEmbed] = useState(false)
  const [embedCopied, setEmbedCopied] = useState(false)
  const [qrSvg, setQrSvg] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const url = `${origin}/lines/${lineId}`
  const embedUrl = `${origin}/lines/${lineId}/embed`

  const embedCode = `<iframe src="${embedUrl}" width="350" height="450" frameborder="0" style="border-radius:12px;border:1px solid #e5e7eb;"></iframe>`
  const directLink = `<a href="${url}">Join the Drop on Waitlyst</a>`

  function handleCopy() {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleCopyEmbed() {
    navigator.clipboard.writeText(embedCode)
    setEmbedCopied(true)
    setTimeout(() => setEmbedCopied(false), 2000)
  }

  async function handleNativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${lineName} - Waitlyst`,
          text: `Join ${lineName} on Waitlyst!`,
          url,
        })
      } catch {
        // User cancelled share
      }
    }
  }

  const fetchQrCode = useCallback(async () => {
    setQrLoading(true)
    try {
      const res = await fetch(`/api/lines/${lineId}/qr?size=300`)
      if (res.ok) {
        const svg = await res.text()
        setQrSvg(svg)
      }
    } finally {
      setQrLoading(false)
    }
  }, [lineId])

  function handleShowQr() {
    setShowQr(true)
    if (!qrSvg) {
      fetchQrCode()
    }
  }

  function handleDownloadSvg() {
    if (!qrSvg) return
    const blob = new Blob([qrSvg], { type: "image/svg+xml" })
    const downloadUrl = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = downloadUrl
    link.download = `${lineName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-qr.svg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(downloadUrl)
  }

  function handleDownloadPng() {
    if (!qrSvg) return
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const pngSize = 600
    canvas.width = pngSize
    canvas.height = pngSize

    const img = new Image()
    const svgBlob = new Blob([qrSvg], { type: "image/svg+xml;charset=utf-8" })
    const svgUrl = URL.createObjectURL(svgBlob)

    img.onload = () => {
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, pngSize, pngSize)
      ctx.drawImage(img, 0, 0, pngSize, pngSize)
      URL.revokeObjectURL(svgUrl)

      canvas.toBlob((blob) => {
        if (!blob) return
        const pngUrl = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = pngUrl
        link.download = `${lineName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-qr.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(pngUrl)
      }, "image/png")
    }
    img.src = svgUrl
  }

  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Join ${lineName} on Waitlyst!`)}&url=${encodeURIComponent(url)}`
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`Join ${lineName} on Waitlyst! ${url}`)}`
  const emailUrl = `mailto:?subject=${encodeURIComponent(`Join ${lineName} on Waitlyst`)}&body=${encodeURIComponent(`Hey! Check out this line on Waitlyst:\n\n${lineName}\n${url}`)}`

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => { setOpen(!open); setShowEmbed(false) }}
        className="gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        Share
      </Button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setShowQr(false); setShowEmbed(false) }} />

          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-50 p-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Share this line</h4>

            {/* Copy Link */}
            <div className="flex items-center gap-2 mb-4">
              <input
                readOnly
                value={url}
                className="flex-1 text-xs px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-600 truncate"
              />
              <Button size="sm" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>

            {/* Share buttons */}
            <div className="flex items-center gap-2 mb-3">
              {typeof navigator !== "undefined" && "share" in navigator && (
                <button
                  onClick={handleNativeShare}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Share
                </button>
              )}
              <a
                href={twitterUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
                title="Share on X/Twitter"
              >
                <svg className="w-4 h-4 text-gray-700" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
                title="Share on WhatsApp"
              >
                <svg className="w-4 h-4 text-gray-700" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
              </a>
              <a
                href={emailUrl}
                className="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
                title="Share via Email"
              >
                <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </a>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-100 my-3" />

            {/* QR Code button */}
            {!showQr ? (
              <button
                onClick={handleShowQr}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6v6H4V4zm10 0h6v6h-6V4zm-10 10h6v6H4v-6zm13 3h1v1h-1v-1zm-3-3h1v1h-1v-1zm3 0h3v3h-3v-3zm0 3h1v1h-1v-1z" />
                </svg>
                QR Code
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">QR Code</span>
                  <button
                    onClick={() => setShowQr(false)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Hide
                  </button>
                </div>
                <div className="flex justify-center">
                  {qrLoading ? (
                    <div className="w-[200px] h-[200px] bg-gray-50 rounded-lg flex items-center justify-center">
                      <svg className="animate-spin h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    </div>
                  ) : qrSvg ? (
                    <div
                      className="w-[200px] h-[200px] rounded-lg overflow-hidden border border-gray-100"
                      dangerouslySetInnerHTML={{ __html: qrSvg }}
                    />
                  ) : (
                    <div className="w-[200px] h-[200px] bg-gray-50 rounded-lg flex items-center justify-center text-sm text-gray-400">
                      Failed to load
                    </div>
                  )}
                </div>
                {qrSvg && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleDownloadSvg}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      SVG
                    </button>
                    <button
                      onClick={handleDownloadPng}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      PNG
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-gray-100 my-3" />

            {/* Embed Widget button */}
            {!showEmbed ? (
              <button
                onClick={() => setShowEmbed(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                Embed Widget
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Embed Widget</span>
                  <button
                    onClick={() => setShowEmbed(false)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Hide
                  </button>
                </div>

                {/* Iframe embed code */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Iframe Embed
                  </label>
                  <textarea
                    readOnly
                    value={embedCode}
                    rows={3}
                    className="w-full text-xs px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-600 font-mono resize-none"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button size="sm" onClick={handleCopyEmbed} className="mt-1 w-full">
                    {embedCopied ? "Copied!" : "Copy Code"}
                  </Button>
                </div>

                {/* Direct link */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Direct Link
                  </label>
                  <textarea
                    readOnly
                    value={directLink}
                    rows={1}
                    className="w-full text-xs px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-600 font-mono resize-none"
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Hidden canvas for PNG export */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
