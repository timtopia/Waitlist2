import { Resend } from "resend"

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

const FROM_ADDRESS = "Waitlyst <onboarding@resend.dev>"

/**
 * Send an email via Resend. Fire-and-forget — never throws.
 * Returns true if sent, false if skipped or errored.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  if (!resend) {
    return false
  }

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    })
    return true
  } catch (error) {
    console.error("Failed to send email:", error)
    return false
  }
}
