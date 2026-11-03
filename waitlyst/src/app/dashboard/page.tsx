import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { DashboardClient } from "./DashboardClient"
import { getMemberPhase } from "@/lib/member-status"
import { countCapacityUsed } from "@/lib/capacity-server"

export const metadata: Metadata = {
  title: "Dashboard",
}

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=%2Fdashboard")
  }

  const [createdLines, positions] = await Promise.all([
    prisma.line.findMany({
      where: { createdById: session.user.id },
      include: {
        // Seated/served parties linger until cleared; count who's still waiting
        _count: { select: { positions: { where: { fulfilled: false } } } },
        positions: {
          where: { fulfilled: false },
          orderBy: { position: "asc" },
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
            // "N in line" means people still waiting, not everyone ever served
            _count: { select: { positions: { where: { fulfilled: false } } } },
          },
        },
      },
      orderBy: { joinedAt: "desc" },
    }),
  ])

  const isNewUser = createdLines.length === 0 && positions.length === 0

  const [aheadCounts, aheadUncalledCounts, capacityUsed] = await Promise.all([
    Promise.all(
      positions.map((pos) =>
        prisma.linePosition.count({
          where: { lineId: pos.lineId, position: { lt: pos.position }, fulfilled: false },
        })
      )
    ),
    // Everyone ahead already called means "you're next", as on the line page
    Promise.all(
      positions.map((pos) =>
        prisma.linePosition.count({
          where: { lineId: pos.lineId, position: { lt: pos.position }, fulfilled: false, calledAt: null },
        })
      )
    ),
    // Served drop buyers still use up spots: "0 waiting" on a sold-out drop
    // looked like a quiet line with plenty of room
    Promise.all(createdLines.map((line) => (line.maxCapacity ? countCapacityUsed(line) : Promise.resolve(null)))),
  ])

  return (
    <DashboardClient
      createdLines={createdLines.map((line, i) => ({
        ...line,
        capacityUsed: capacityUsed[i],
        createdAt: line.createdAt.toISOString(),
        updatedAt: line.updatedAt.toISOString(),
        opensAt: line.opensAt?.toISOString() ?? null,
        closesAt: line.closesAt?.toISOString() ?? null,
        frontPerson: line.positions[0]
          ? { ...line.positions[0], calledAt: line.positions[0].calledAt?.toISOString() ?? null }
          : null,
      }))}
      positions={positions.map((pos, i) => ({
        ...pos,
        ahead: aheadCounts[i],
        phase: getMemberPhase({
          fulfilled: pos.fulfilled,
          ahead: aheadCounts[i],
          aheadUncalled: aheadUncalledCounts[i],
          calledAt: pos.calledAt,
        }),
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
