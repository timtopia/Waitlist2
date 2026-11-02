import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sendDueLineReminders } from "@/lib/line-reminders"
import { expireMissedCalls } from "@/lib/missed-calls"

export const dynamic = "force-dynamic"

/**
 * Skip called people whose time to show up ran out, on lines nobody happens
 * to be looking at. Viewing a line does this too, but when the host steps
 * away and nobody else has the page open, a no-show would sit at the front
 * -- and not be told they lost their place -- until someone next looks.
 */
async function sweepMissedCalls(): Promise<number> {
  const lines = await prisma.line.findMany({
    where: {
      isActive: true,
      responseWindowMinutes: { not: null },
      positions: { some: { fulfilled: false, calledAt: { not: null } } },
    },
    select: { id: true, responseWindowMinutes: true },
    take: 100,
  })
  let skipped = 0
  for (const line of lines) {
    try {
      skipped += await expireMissedCalls(line.id, line.responseWindowMinutes!)
    } catch (error) {
      // One line's trouble shouldn't stop the rest from moving
      console.error(`Missed-call sweep failed for line ${line.id}:`, error)
    }
  }
  return skipped
}

/**
 * Sweep for lines that have opened and email the people waiting to hear,
 * and skip no-shows on lines nobody is viewing. Viewing a line also triggers
 * both for that line; the sweep catches lines nobody happens to look at.
 * Vercel Cron (or any scheduler) calls it with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // Each job runs even if the other fails, and a failure is reported as one
  // so the scheduler's logs show it rather than a quiet 200
  const [sent, skipped] = await Promise.allSettled([sendDueLineReminders(), sweepMissedCalls()])
  for (const r of [sent, skipped]) {
    if (r.status === "rejected") console.error("Cron job failed:", r.reason)
  }
  const ok = sent.status === "fulfilled" && skipped.status === "fulfilled"
  return NextResponse.json(
    {
      sent: sent.status === "fulfilled" ? sent.value : null,
      skippedNoShows: skipped.status === "fulfilled" ? skipped.value : null,
    },
    { status: ok ? 200 : 500 }
  )
}
