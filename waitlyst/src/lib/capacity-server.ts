import type { Prisma, PrismaClient } from "@prisma/client"
import { prisma as defaultClient } from "./prisma"
import { capacityUsed } from "./capacity"

type Db = PrismaClient | Prisma.TransactionClient

/**
 * How much of a line's capacity is used, read from the database. See
 * capacityUsed for the rule; this adds the served-and-cleared count that
 * STANDARD lines need, which lives in the visit history.
 */
export async function countCapacityUsed(
  line: { id: string; kind: "STANDARD" | "RESTAURANT" },
  db: Db = defaultClient
): Promise<number> {
  if (line.kind === "RESTAURANT") {
    const { _sum } = await db.linePosition.aggregate({
      where: { lineId: line.id, fulfilled: false },
      _sum: { partySize: true },
    })
    return _sum.partySize ?? 0
  }
  const [inLine, servedAndCleared] = await Promise.all([
    db.linePosition.count({ where: { lineId: line.id } }),
    db.queueVisit.count({ where: { lineId: line.id, outcome: "SERVED" } }),
  ])
  return inLine + servedAndCleared
}
