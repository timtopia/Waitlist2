import { Resend } from "resend"

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

/**
 * Email is on only when both RESEND_API_KEY and EMAIL_FROM are set.
 * Resend's shared test sender only delivers to the Resend account's own
 * address, so without a verified EMAIL_FROM nothing reaches real users --
 * and anything that promises an email (reminders, "you'll be emailed") is
 * hidden rather than promising what won't arrive.
 */
export function emailEnabled(): boolean {
  return !!resend && !!process.env.EMAIL_FROM
}

/**
 * Send an email via Resend. Fire-and-forget — never throws.
 * Returns true if sent, false if skipped or errored.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  if (!resend || !emailEnabled()) {
    return false
  }

  try {
    // The client reports API errors (unverified domain, bad address) in the
    // result rather than throwing
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to,
      subject,
      html,
    })
    if (error) {
      console.error("Resend refused email:", error)
      return false
    }
    return true
  } catch (error) {
    console.error("Failed to send email:", error)
    return false
  }
}
