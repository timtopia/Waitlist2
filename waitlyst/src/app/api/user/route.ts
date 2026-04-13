import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-helpers"
import { prisma } from "@/lib/prisma"

export async function PATCH(req: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result

  const body = await req.json()
  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (name.length === 0 || name.length > 50) {
    return NextResponse.json(
      { error: "Name must be between 1 and 50 characters" },
      { status: 400 }
    )
  }

  const updatedUser = await prisma.user.update({
    where: { id: result.userId },
    data: { name },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      createdAt: true,
    },
  })

  return NextResponse.json(updatedUser)
}

export const dynamic = "force-dynamic"
