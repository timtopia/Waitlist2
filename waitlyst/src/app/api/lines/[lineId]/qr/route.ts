import QRCode from "qrcode"
import { prisma } from "@/lib/prisma"

function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000"
}

// Generate a QR code SVG for a line (public, no auth required)
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const { lineId } = await params

  try {
    // Verify the line exists
    const line = await prisma.line.findUnique({
      where: { id: lineId },
      select: { id: true },
    })

    if (!line) {
      return new Response("Line not found", { status: 404 })
    }

    const url = new URL(req.url)
    const size = Math.min(Math.max(parseInt(url.searchParams.get("size") || "300", 10) || 300, 100), 1000)
    const dark = url.searchParams.get("dark") || "000000"
    const light = url.searchParams.get("light") || "ffffff"

    // Validate hex color format (6 hex chars)
    const hexPattern = /^[0-9a-fA-F]{6}$/
    const darkColor = hexPattern.test(dark) ? `#${dark}` : "#000000"
    const lightColor = hexPattern.test(light) ? `#${light}` : "#ffffff"

    const lineUrl = `${getBaseUrl()}/lines/${lineId}`

    const svg = await QRCode.toString(lineUrl, {
      type: "svg",
      width: size,
      margin: 2,
      color: {
        dark: darkColor,
        light: lightColor,
      },
    })

    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    })
  } catch (error) {
    console.error("QR code generation error:", error)
    return new Response("Something went wrong while generating the QR code.", { status: 500 })
  }
}
