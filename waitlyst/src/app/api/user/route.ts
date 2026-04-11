import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const name = typeof body.name === "string" ? body.name.trim() : ""

  if (name.length === 0 || name.length > 50) {
    return NextResponse.json(
      { error: "Name must be between 1 and 50 characters" },
      { status: 400 }
    )
  }

  const updatedUser = await prisma.user.update({
    where: { id: session.user.id },
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
