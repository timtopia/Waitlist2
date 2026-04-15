import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"

const limiter = rateLimit({ interval: 60_000, limit: 5 })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lineId: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { success: allowed } = limiter.check(result.userId)
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  const { lineId } = await params

  try {
    const position = await prisma.$transaction(async (tx) => {
      // Check if line exists and is active
      const line = await tx.line.findUnique({
        where: { id: lineId, isActive: true },
      })
      if (!line) {
        throw new Error("Line not found or inactive")
      }

      // Check if line has opened yet
      if (line.opensAt && new Date() < new Date(line.opensAt)) {
        throw new Error("This line hasn't opened yet")
      }

      // Check if line has closed
      if (line.closesAt && new Date() > new Date(line.closesAt)) {
        throw new Error("This line is closed")
      }

      // Creator cannot join their own line
      if (line.createdById === result.userId) {
        throw new Error("You cannot join your own line")
      }

      // Check if already in line
      const existing = await tx.linePosition.findUnique({
        where: { lineId_userId: { lineId, userId: result.userId } },
      })
      if (existing) {
        throw new Error("Already in this line")
      }

      // Check capacity
      if (line.maxCapacity) {
        const currentCount = await tx.linePosition.count({
          where: { lineId },
        })
        if (currentCount >= line.maxCapacity) {
          throw new Error("This line is full")
        }
      }

      // Get next position number
      const lastPosition = await tx.linePosition.findFirst({
        where: { lineId },
        orderBy: { position: "desc" },
      })
      const nextPosition = (lastPosition?.position ?? 0) + 1

      // Create position
      return tx.linePosition.create({
        data: {
          lineId,
          userId: result.userId,
          position: nextPosition,
        },
        include: {
          user: { select: { id: true, name: true, image: true } },
        },
      })
    })

    return NextResponse.json(position)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to join line"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
