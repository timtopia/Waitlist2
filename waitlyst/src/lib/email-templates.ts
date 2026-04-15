function wrapTemplate(title: string, body: string, ctaText: string, ctaUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
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

export function positionCalledEmail(
  userName: string,
  lineName: string,
  lineUrl: string
): { subject: string; html: string } {
  const subject = `You're up! You've been called in ${lineName}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">You're up, ${userName}!</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">You've been called to the front of <strong>${lineName}</strong>.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Please come forward as soon as possible so you don't lose your spot.</p>
  `
  return { subject, html: wrapTemplate(subject, body, "Go to Line", lineUrl) }
}

export function swapOfferEmail(
  userName: string,
  lineName: string,
  offerAmount: number,
  lineUrl: string
): { subject: string; html: string } {
  const formattedAmount = offerAmount.toLocaleString("en-US", { style: "currency", currency: "USD" })
  const subject = `New swap offer: ${formattedAmount} in ${lineName}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">New swap offer, ${userName}!</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">Someone offered <strong>${formattedAmount}</strong> to swap positions with you in <strong>${lineName}</strong>.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Review the offer and accept or decline it before it expires.</p>
  `
  return { subject, html: wrapTemplate(subject, body, "View Offer", lineUrl) }
}

export function swapAcceptedEmail(
  userName: string,
  lineName: string,
  lineUrl: string
): { subject: string; html: string } {
  const subject = `Your swap offer was accepted in ${lineName}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">Offer accepted, ${userName}!</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">Your swap offer in <strong>${lineName}</strong> has been accepted.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Head over to the line to complete the swap.</p>
  `
  return { subject, html: wrapTemplate(subject, body, "Go to Line", lineUrl) }
}

export function lineOpeningEmail(
  userName: string,
  lineName: string,
  opensAt: string,
  lineUrl: string
): { subject: string; html: string } {
  const subject = `${lineName} opens in 30 minutes`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">Get ready, ${userName}!</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;"><strong>${lineName}</strong> opens at <strong>${opensAt}</strong>.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Make sure you're ready to join when it opens.</p>
  `
  return { subject, html: wrapTemplate(subject, body, "View Line", lineUrl) }
}

export function fulfilledEmail(
  userName: string,
  lineName: string,
  lineUrl: string
): { subject: string; html: string } {
  const subject = `You've been fulfilled in ${lineName}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">All done, ${userName}!</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">You've been marked as fulfilled in <strong>${lineName}</strong>.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Thanks for using Waitlyst!</p>
  `
  return { subject, html: wrapTemplate(subject, body, "View Line", lineUrl) }
}
