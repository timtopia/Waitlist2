function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function wrapTemplate(title: string, body: string, ctaText: string, ctaUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color:#2563eb;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Waitlyst</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${body}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td style="border-radius:6px;background-color:#2563eb;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">${ctaText}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">You received this email because you have an account on Waitlyst. If you no longer wish to receive these emails, you can turn them off in your profile settings.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export interface ServiceEmailOptions {
  /** Restaurant lines seat parties at a host stand rather than serve people */
  isRestaurant?: boolean
  /** Minutes a called party has to show up; null/undefined when there's no limit */
  windowMinutes?: number | null
}

export function positionCalledEmail(
  userName: string,
  lineName: string,
  lineUrl: string,
  opts: ServiceEmailOptions = {}
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const subject = `You're up! You've been called in ${lineName}`
  const deadline = opts.windowMinutes
    ? `You have ${opts.windowMinutes} min to get there, or your place goes to the next ${opts.isRestaurant ? "party" : "person"}. Open the line and tap "On my way" if you need a little more time.`
    : "Please come forward as soon as possible so you don't lose your spot."
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">You're up, ${safeName}!</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">${opts.isRestaurant
      ? `Your table is ready at <strong>${safeLine}</strong>. Head to the host stand.`
      : `You've been called to the front of <strong>${safeLine}</strong>.`}</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">${deadline}</p>
  `
  return { subject, html: wrapTemplate(subject, body, "Go to Line", lineUrl) }
}

export function youreNextEmail(
  userName: string,
  lineName: string,
  lineUrl: string,
  isRestaurant = false
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const subject = `You're next in ${lineName}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">You're next, ${safeName}</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">The ${isRestaurant ? "party" : "person"} ahead of you in <strong>${safeLine}</strong> was just called.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Head back now so you're ready when it's your turn.</p>
  `
  return { subject, html: wrapTemplate(subject, body, "Go to Line", lineUrl) }
}

export function removedFromLineEmail(
  userName: string,
  lineName: string,
  refunded: boolean,
  lineUrl: string,
  missedCall = false,
  charged = false,
  isRestaurant = false
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const subject = `You're no longer in ${lineName}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">You're no longer in line, ${safeName}</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">${missedCall
      ? `You were called in <strong>${safeLine}</strong> but didn't show up in time, so your place was given to the next ${isRestaurant ? "party" : "person"}.`
      : `The ${isRestaurant ? "host" : "organizer"} of <strong>${safeLine}</strong> removed you from the line.`}</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">${refunded
      ? "A payment of yours that was on hold for this line has been released or refunded."
      : charged
        ? "You've been charged for the spot you bought -- the person you bought it from gave up their place, so it isn't refunded. If you think this was a mistake, contact the organizer."
        : "If you think this was a mistake, contact the organizer."}</p>
  `
  return { subject, html: wrapTemplate(subject, body, "View Line", lineUrl) }
}

export function swapOfferEmail(
  userName: string,
  lineName: string,
  offerAmount: number,
  lineUrl: string
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const formattedAmount = offerAmount.toLocaleString("en-US", { style: "currency", currency: "USD" })
  const subject = `New swap offer: ${formattedAmount} in ${lineName}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">New swap offer, ${safeName}!</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">Someone offered <strong>${formattedAmount}</strong> to swap positions with you in <strong>${safeLine}</strong>.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Review the offer and accept or decline it before it expires.</p>
  `
  return { subject, html: wrapTemplate(subject, body, "View Offer", lineUrl) }
}

export function swapAcceptedEmail(
  userName: string,
  lineName: string,
  lineUrl: string
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const subject = `Your swap offer was accepted in ${lineName}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">Offer accepted, ${safeName}!</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">Your swap offer in <strong>${safeLine}</strong> has been accepted.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Head over to the line to complete the swap.</p>
  `
  return { subject, html: wrapTemplate(subject, body, "Go to Line", lineUrl) }
}

export function lineOpeningEmail(
  userName: string,
  lineName: string,
  lineUrl: string
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const subject = `${lineName} is open`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">It's open, ${safeName}!</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;"><strong>${safeLine}</strong> is now taking people.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Join now to get a good place in line.</p>
  `
  return { subject, html: wrapTemplate(subject, body, "Join the Line", lineUrl) }
}

export function fulfilledEmail(
  userName: string,
  lineName: string,
  lineUrl: string,
  opts: ServiceEmailOptions = {}
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const subject = opts.isRestaurant ? `You've been seated at ${lineName}` : `You've been served in ${lineName}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">All done, ${safeName}!</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">${opts.isRestaurant
      ? `You've been seated at <strong>${safeLine}</strong>. Enjoy your meal.`
      : `You've been marked as served in <strong>${safeLine}</strong>.`}</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Thanks for using Waitlyst!</p>
  `
  return { subject, html: wrapTemplate(subject, body, "View Line", lineUrl) }
}

export function positionSoldEmail(
  userName: string,
  lineName: string,
  amount: number,
  newPosition: number,
  lineUrl: string,
  heldUntilSeated = false,
  /** The seller has a payout account connected, so money can reach them */
  payoutReady = false
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const formattedAmount = amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
  const subject = `Your spot in ${lineName} sold for ${formattedAmount}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">Your spot sold, ${safeName}!</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">Someone bought your position in <strong>${safeLine}</strong> for <strong>${formattedAmount}</strong>. You traded places with them and are now <strong>#${newPosition}</strong>.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">${[
      heldUntilSeated
        ? "The buyer's payment is held until they're seated, and you're paid once it's collected."
        : payoutReady
          ? "You're paid right away."
          : "",
      payoutReady ? "" : "Connect a payout account in your profile so the money can reach you.",
    ].filter(Boolean).join(" ")}</p>
  `
  return { subject, html: wrapTemplate(subject, body, "View Line", lineUrl) }
}

export function lineDeletedEmail(
  userName: string,
  lineName: string,
  hadPurchase: boolean,
  browseUrl: string
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const subject = `${lineName} has been closed`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">This line has closed, ${safeName}</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">The organizer deleted <strong>${safeLine}</strong>, so your place in it is gone.</p>
    ${hadPurchase
      ? `<p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Any payment you made to move up in this line has been returned to you. A hold on your card is released right away; a completed charge is refunded and can take a few days to appear.</p>`
      : ""}
  `
  return { subject, html: wrapTemplate(subject, body, "Browse Other Lines", browseUrl) }
}
