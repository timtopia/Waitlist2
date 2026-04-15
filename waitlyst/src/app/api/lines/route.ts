import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"

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

  const { name, description, isPublic = true, opensAt, closesAt, maxCapacity, ownerFeePercent = 0, productName, productImage, productPrice, productUrl, allowResale = true, maxAskingPrice, hideCapacity = false } = await req.json()

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }

  if (maxCapacity !== undefined && maxCapacity !== null) {
    if (typeof maxCapacity !== "number" || maxCapacity < 1 || !Number.isInteger(maxCapacity)) {
      return NextResponse.json({ error: "Max capacity must be a positive integer" }, { status: 400 })
    }
  }

  if (opensAt && closesAt && new Date(opensAt) >= new Date(closesAt)) {
    return NextResponse.json({ error: "Close time must be after open time" }, { status: 400 })
  }

  // Validate product fields
  if (productPrice !== undefined && productPrice !== null) {
    if (typeof productPrice !== "number" || productPrice <= 0) {
      return NextResponse.json({ error: "Product price must be a positive number" }, { status: 400 })
    }
  }

  if (productUrl !== undefined && productUrl !== null && productUrl !== "") {
    try {
      new URL(productUrl)
    } catch {
      return NextResponse.json({ error: "Product URL must be a valid URL" }, { status: 400 })
    }
  }

  // Validate resale controls
  if (maxAskingPrice !== undefined && maxAskingPrice !== null) {
    if (typeof maxAskingPrice !== "number" || maxAskingPrice <= 0) {
      return NextResponse.json({ error: "Max asking price must be a positive number" }, { status: 400 })
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
}
