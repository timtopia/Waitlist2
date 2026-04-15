import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { validateString, validateNumber, validateUrl } from "@/lib/validate"

const createLimiter = rateLimit({ interval: 60_000, limit: 5 })
const browseLimiter = rateLimit({ interval: 60_000, limit: 30 })

export async function POST(req: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { success: allowed } = createLimiter.check(result.userId)
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  try {
    const { name, description, isPublic = true, opensAt, closesAt, maxCapacity, ownerFeePercent = 0, productName, productImage, productPrice, productUrl, allowResale = true, maxAskingPrice, hideCapacity = false } = await req.json()

    // Validate name (required, 1-100 chars)
    const nameErr = validateString(name, "Name", { min: 1, max: 100 })
    if (nameErr) {
      return NextResponse.json({ error: nameErr }, { status: 400 })
    }

    // Validate description (optional, max 500 chars)
    if (description !== undefined && description !== null && description !== "") {
      const descErr = validateString(description, "Description", { min: 0, max: 500 })
      if (descErr) {
        return NextResponse.json({ error: descErr }, { status: 400 })
      }
    }

    // Validate capacity (optional, positive integer)
    if (maxCapacity !== undefined && maxCapacity !== null) {
      if (typeof maxCapacity !== "number" || maxCapacity < 1 || !Number.isInteger(maxCapacity)) {
        return NextResponse.json({ error: "Capacity must be a positive whole number" }, { status: 400 })
      }
    }

    if (opensAt && closesAt && new Date(opensAt) >= new Date(closesAt)) {
      return NextResponse.json({ error: "Close time must be after open time" }, { status: 400 })
    }

    // Validate owner fee percent (0-50)
    if (ownerFeePercent !== undefined && ownerFeePercent !== null && ownerFeePercent !== 0) {
      const feeErr = validateNumber(ownerFeePercent, "Owner fee percent", { min: 0, max: 50 })
      if (feeErr) {
        return NextResponse.json({ error: feeErr }, { status: 400 })
      }
    }

    // Validate product price (optional, positive number, max $10,000)
    if (productPrice !== undefined && productPrice !== null) {
      const priceErr = validateNumber(productPrice, "Product price", { min: 0.01, max: 10000 })
      if (priceErr) {
        return NextResponse.json({ error: priceErr }, { status: 400 })
      }
    }

    // Validate product URL (optional, must be valid URL)
    if (productUrl !== undefined && productUrl !== null && productUrl !== "") {
      const urlErr = validateUrl(productUrl, "Product URL")
      if (urlErr) {
        return NextResponse.json({ error: urlErr }, { status: 400 })
      }
    }

    // Validate max asking price (optional, positive number)
    if (maxAskingPrice !== undefined && maxAskingPrice !== null) {
      const maxPriceErr = validateNumber(maxAskingPrice, "Max asking price", { min: 0.01, max: 10000 })
      if (maxPriceErr) {
        return NextResponse.json({ error: maxPriceErr }, { status: 400 })
      }
    }

    const feePercent = typeof ownerFeePercent === "number" ? Math.max(0, Math.min(ownerFeePercent, 50)) : 0

    const line = await prisma.line.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        createdById: result.userId,
        isPublic: Boolean(isPublic),
        opensAt: opensAt ? new Date(opensAt) : null,
        closesAt: closesAt ? new Date(closesAt) : null,
        maxCapacity: maxCapacity || null,
        ownerFeePercent: feePercent,
        productName: productName?.trim() || null,
        productImage: productImage?.trim() || null,
        productPrice: productPrice || null,
        productUrl: productUrl?.trim() || null,
        allowResale: typeof allowResale === "boolean" ? allowResale : true,
        maxAskingPrice: maxAskingPrice || null,
        hideCapacity: typeof hideCapacity === "boolean" ? hideCapacity : false,
      },
    })

    return NextResponse.json(line)
  } catch (error) {
    console.error("Create line error:", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous"
  const { success: allowed } = browseLimiter.check(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  try {
    const lines = await prisma.line.findMany({
      where: { isActive: true, isPublic: true },
      include: {
        createdBy: { select: { name: true, image: true } },
        _count: { select: { positions: true } },
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(lines, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    })
  } catch (error) {
    console.error("Browse lines error:", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}
