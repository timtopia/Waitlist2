import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { name, description, isPublic = true, opensAt, closesAt, maxCapacity, ownerFeePercent = 0, productName, productImage, productPrice, productUrl } = await req.json()

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

  const feePercent = typeof ownerFeePercent === "number" ? Math.max(0, Math.min(ownerFeePercent, 50)) : 0

  const line = await prisma.line.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      createdById: session.user.id,
      isPublic: Boolean(isPublic),
      opensAt: opensAt ? new Date(opensAt) : null,
      closesAt: closesAt ? new Date(closesAt) : null,
      maxCapacity: maxCapacity || null,
      ownerFeePercent: feePercent,
      productName: productName?.trim() || null,
      productImage: productImage?.trim() || null,
      productPrice: productPrice || null,
      productUrl: productUrl?.trim() || null,
    },
  })

  return NextResponse.json(line)
}

export async function GET() {
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
