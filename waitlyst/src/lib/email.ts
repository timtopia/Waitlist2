import { Resend } from "resend"

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

// Resend's shared onboarding@resend.dev sender only delivers to the Resend
// account's own address, so real users get nothing until EMAIL_FROM is set
// to an address on a domain verified in Resend.
const FROM_ADDRESS = process.env.EMAIL_FROM || "Waitlyst <onboarding@resend.dev>"
if (resend && !process.env.EMAIL_FROM) {
  console.warn("EMAIL_FROM isn't set: emails go from onboarding@resend.dev and only reach the Resend account owner.")
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
  if (!resend) {
    return false
  }

  try {
    // The client reports API errors (unverified domain, bad address) in the
    // result rather than throwing
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
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
