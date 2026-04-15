import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { validateString, validateBoolean } from "@/lib/validate"

const userUpdateLimiter = rateLimit({ interval: 60_000, limit: 10 })

export async function GET() {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  try {
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
  } catch (error) {
    console.error("Get user error:", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
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

  try {
    const body = await req.json()

    const data: Record<string, unknown> = {}

    // Handle name update (1-50 chars)
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
      const boolErr = validateBoolean(body.emailNotifications, "Email notifications")
      if (boolErr) {
        return NextResponse.json({ error: boolErr }, { status: 400 })
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
  } catch (error) {
    console.error("Update user error:", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}

export const dynamic = "force-dynamic"
