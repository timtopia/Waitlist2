import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { DashboardClient } from "./DashboardClient"

export const metadata: Metadata = {
  title: "Dashboard",
}

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect("/")
  }

  const [createdLines, positions] = await Promise.all([
    prisma.line.findMany({
      where: { createdById: session.user.id },
      include: {
        _count: { select: { positions: true } },
        positions: {
          where: { position: 1 },
          include: {
            user: { select: { id: true, name: true } },
          },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.linePosition.findMany({
      where: { userId: session.user.id },
      include: {
        line: {
          include: {
            _count: { select: { positions: true } },
          },
        },
      },
      orderBy: { joinedAt: "desc" },
    }),
  ])

  const isNewUser = createdLines.length === 0 && positions.length === 0

  return (
    <DashboardClient
      createdLines={createdLines.map((line) => ({
        ...line,
        createdAt: line.createdAt.toISOString(),
        updatedAt: line.updatedAt.toISOString(),
        frontPerson: line.positions[0] || null,
      }))}
      positions={positions.map((pos) => ({
        ...pos,
        askingPrice: pos.askingPrice?.toString() || null,
        joinedAt: pos.joinedAt.toISOString(),
        updatedAt: pos.updatedAt.toISOString(),
        line: {
          ...pos.line,
          createdAt: pos.line.createdAt.toISOString(),
          updatedAt: pos.line.updatedAt.toISOString(),
        },
      }))}
      isNewUser={isNewUser}
    />
  )
}
