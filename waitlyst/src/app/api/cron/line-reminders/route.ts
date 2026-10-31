import { NextResponse } from "next/server"
import { sendDueLineReminders } from "@/lib/line-reminders"

export const dynamic = "force-dynamic"

/**
 * Sweep for lines that have opened and email the people waiting to hear.
 * Viewing a line also triggers this for that line; the sweep catches lines
 * nobody happens to look at. Vercel Cron (or any scheduler) calls it with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sent = await sendDueLineReminders()
  return NextResponse.json({ sent })
}
