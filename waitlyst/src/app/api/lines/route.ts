import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { name, description, isPublic = true, opensAt, closesAt, maxCapacity } = await req.json()

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

  const line = await prisma.line.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      createdById: session.user.id,
      isPublic: Boolean(isPublic),
      opensAt: opensAt ? new Date(opensAt) : null,
      closesAt: closesAt ? new Date(closesAt) : null,
      maxCapacity: maxCapacity || null,
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

  return NextResponse.json(lines)
}
