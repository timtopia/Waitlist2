import { prisma } from "./prisma"
import { sendEmail } from "./email"
import { lineOpeningEmail } from "./email-templates"
import { getBaseUrl } from "./stripe"

/**
 * Email everyone who asked to hear when a line opens, for lines whose
 * opening time has passed. Each reminder is claimed before sending, so
 * overlapping runs (a page view and the cron at once) never email twice.
 * Pass a lineId to only look at that line.
 * Returns how many emails were sent.
 */
export async function sendDueLineReminders(lineId?: string): Promise<number> {
  const now = new Date()
  const due = await prisma.lineReminder.findMany({
    where: {
      sentAt: null,
      ...(lineId && { lineId }),
      line: { isActive: true, opensAt: { lte: now } },
    },
    include: {
      line: { select: { id: true, name: true, closesAt: true } },
      user: { select: { name: true, email: true, emailNotifications: true } },
    },
    take: 200,
  })

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

    const { subject, html } = lineOpeningEmail(
      reminder.user.name || "there",
      reminder.line.name,
      `${getBaseUrl()}/lines/${reminder.line.id}`
    )
    if (await sendEmail(reminder.user.email, subject, html)) sent++
  }
  return sent
}
