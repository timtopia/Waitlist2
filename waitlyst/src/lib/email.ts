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
 * Plain-text version of an email's HTML. Some mail apps, watches and lock
 * screen previews only show text, and HTML-only mail is more likely to be
 * filed as spam -- so every email carries both. Links keep their URL so the
 * call to action still works without HTML.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim()
      return text ? `${text}: ${href}` : href
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|tr|div|table)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export interface SendEmailOptions {
  /**
   * Same key, same email: Resend drops a repeat within 24 hours. Lets a
   * retry after an ambiguous failure (a timeout after Resend accepted it)
   * go out safely without the person getting it twice.
   */
  idempotencyKey?: string
}

/**
 * Send an email via Resend. Fire-and-forget — never throws.
 * Returns true if sent, false if skipped or errored.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  { idempotencyKey }: SendEmailOptions = {}
): Promise<boolean> {
  if (!resend || !emailEnabled()) {
    return false
  }

  try {
    // The client reports API errors (unverified domain, bad address) in the
    // result rather than throwing
    // Gmail and Yahoo show an "Unsubscribe" button only with this header;
    // without it, someone tired of a big drop's emails hits "Report spam",
    // which hurts delivery of everyone's "You're up" emails
    const base = process.env.NEXTAUTH_URL || process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
    const payload = {
      from: process.env.EMAIL_FROM!,
      to,
      subject,
      html,
      text: htmlToText(html),
      ...(base && { headers: { "List-Unsubscribe": `<${base.replace(/\/$/, "")}/profile>` } }),
    }
    const send = () => (idempotencyKey ? resend!.emails.send(payload, { idempotencyKey }) : resend!.emails.send(payload))
    let { error } = await send()
    // Closing a 300-person line or a drop opening sends a burst; Resend
    // refuses past a few a second, and those emails were simply lost. A
    // refused send never went out, so retrying it can't double-send.
    for (let attempt = 1; error?.name === "rate_limit_exceeded" && attempt <= 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt + Math.random() * 400))
      ;({ error } = await send())
    }
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
