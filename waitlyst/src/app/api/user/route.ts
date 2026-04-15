import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"

const userUpdateLimiter = rateLimit({ interval: 60_000, limit: 10 })

export async function GET() {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const user = await prisma.user.findUnique({
    where: { id: result.userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      stripeConnectOnboarded: true,
      emailNotifications: true,
      createdAt: true,
    },
  })

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  return NextResponse.json(user)
}

export async function PATCH(req: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const { success: allowed } = userUpdateLimiter.check(result.userId)
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  const body = await req.json()

  const data: Record<string, unknown> = {}

  // Handle name update
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (name.length === 0 || name.length > 50) {
      return NextResponse.json(
        { error: "Name must be between 1 and 50 characters" },
        { status: 400 }
      )
    }
    data.name = name
  }

  // Handle emailNotifications update
  if (body.emailNotifications !== undefined) {
    if (typeof body.emailNotifications !== "boolean") {
      return NextResponse.json(
        { error: "emailNotifications must be a boolean" },
        { status: 400 }
      )
    }
    data.emailNotifications = body.emailNotifications
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    )
  }

  const updatedUser = await prisma.user.update({
    where: { id: result.userId },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      emailNotifications: true,
      createdAt: true,
    },
  })

  return NextResponse.json(updatedUser)
}

export const dynamic = "force-dynamic"
