import { prisma } from "./prisma"
import { emailEnabled, sendEmail } from "./email"
import { lineOpeningEmail } from "./email-templates"
import { getBaseUrl } from "./stripe"
import { countCapacityUsed } from "./capacity-server"

/**
 * Email everyone who asked to hear when a line opens, for lines whose
 * opening time has passed. Each reminder is claimed before sending, so
 * overlapping runs (a page view and the cron at once) never email twice.
 * Pass a lineId to only look at that line.
 * Returns how many emails were sent.
 */
export async function sendDueLineReminders(lineId?: string): Promise<number> {
  // Leave reminders unsent (not used up) until email is set up
  if (!emailEnabled()) return 0
  const now = new Date()
  const due = await prisma.lineReminder.findMany({
    where: {
      sentAt: null,
      ...(lineId && { lineId }),
      line: { isActive: true, opensAt: { lte: now } },
    },
    include: {
      line: { select: { id: true, name: true, closesAt: true, kind: true, maxCapacity: true } },
      user: { select: { name: true, email: true, emailNotifications: true } },
    },
    take: 200,
  })

  // A hyped drop can fill before every batch of "it's open, join now" goes
  // out; telling people to join a full line only sends them to a dead end.
  const fullByLine = new Map<string, boolean>()
  const isFull = async (line: (typeof due)[number]["line"]) => {
    if (line.maxCapacity == null) return false
    let full = fullByLine.get(line.id)
    if (full === undefined) {
      full = (await countCapacityUsed(line)) >= line.maxCapacity
      fullByLine.set(line.id, full)
    }
    return full
  }

  let sent = 0
  for (const reminder of due) {
    const { count } = await prisma.lineReminder.updateMany({
      where: { id: reminder.id, sentAt: null },
      data: { sentAt: now },
    })
    if (count === 0) continue // another run took it
    // Too late to be useful, or they've turned emails off
    if (reminder.line.closesAt && reminder.line.closesAt <= now) continue
    if (!reminder.user.email || !reminder.user.emailNotifications) continue
    // They were watching and joined the moment it opened: "join now" would
    // only be noise
    const joined = await prisma.linePosition.findUnique({
      where: { lineId_userId: { lineId: reminder.lineId, userId: reminder.userId } },
      select: { id: true },
    })
    if (joined) continue
    if (await isFull(reminder.line)) continue

    const { subject, html } = lineOpeningEmail(
      reminder.user.name || "there",
      reminder.line.name,
      `${getBaseUrl()}/lines/${reminder.line.id}`
    )
    // The reminder is already used up, so a one-off provider hiccup would
    // mean they never hear the line opened: try once more before giving up.
    // (Not released for later runs -- page views re-run this every few
    // seconds, which would hammer an address that always bounces.) The
    // idempotency key keeps a retry after a timeout that actually went
    // through from landing a second copy.
    const opts = { idempotencyKey: `line-reminder/${reminder.id}` }
    if (
      (await sendEmail(reminder.user.email, subject, html, opts)) ||
      (await sendEmail(reminder.user.email, subject, html, opts))
    ) sent++
  }
  return sent
}
