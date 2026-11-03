import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

/**
 * Require authentication. Returns the user ID or a 401 response.
 */
export async function requireAuth(): Promise<{ userId: string } | NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Your session expired. Sign in again to continue." }, { status: 401 })
  }
  return { userId: session.user.id }
}

/**
 * Require authentication AND line ownership. Returns userId + line, or an error response.
 */
export async function requireLineOwner(lineId: string): Promise<{ userId: string; line: any } | NextResponse> {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult

  const line = await prisma.line.findUnique({ where: { id: lineId } })
  if (!line) {
    return NextResponse.json({ error: "Line not found" }, { status: 404 })
  }
  if (line.createdById !== authResult.userId) {
    return NextResponse.json({ error: "Only the line's organizer can do that." }, { status: 403 })
  }
  return { userId: authResult.userId, line }
}
