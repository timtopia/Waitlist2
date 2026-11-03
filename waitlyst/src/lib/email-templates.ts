import { OFFER_TTL_MS } from "./offers"

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Where to turn emails off: the profile page on the same site the email
 * links to. Saying "in your profile settings" without a link leaves someone
 * who's had enough hunting for it -- or reaching for the spam button.
 */
function profileUrlFor(ctaUrl: string): string | null {
  try {
    return `${new URL(ctaUrl).origin}/profile`
  } catch {
    return null
  }
}

function wrapTemplate(title: string, body: string, ctaText: string, ctaUrl: string): string {
  const settingsUrl = profileUrlFor(ctaUrl)
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
                    <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">${ctaText}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">You received this email because you have an account on Waitlyst. ${settingsUrl
                ? `To stop these emails, turn off email notifications in your <a href="${escapeHtml(settingsUrl)}" style="color:#6b7280;">profile settings</a>.`
                : "To stop these emails, turn off email notifications in your profile settings."}</p>
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
  /** The host called them again: a copy of the first email read as a glitch */
  recall?: boolean
}

export function positionCalledEmail(
  userName: string,
  lineName: string,
  lineUrl: string,
  opts: ServiceEmailOptions = {}
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  // The subject is often all that shows on a lock screen, so it carries the
  // what and the deadline on its own
  const subject = `${opts.recall ? "Reminder: " : ""}${opts.isRestaurant ? `Your table is ready at ${lineName}` : `You're up in ${lineName}`}${
    opts.windowMinutes ? ` -- arrive within ${opts.windowMinutes} min` : ""
  }`
  const deadline = opts.windowMinutes
    ? `You have ${opts.windowMinutes} min to get there, or your place goes to the next ${opts.isRestaurant ? "party" : "person"}. Open the line and tap "On my way" if you need a little more time.`
    : "Please come forward as soon as possible so you don't lose your spot."
  const recalled = opts.recall
    ? `<p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">The ${opts.isRestaurant ? "host" : "organizer"} called you again${opts.windowMinutes ? `, so your ${opts.windowMinutes} ${opts.windowMinutes === 1 ? "minute starts" : "minutes start"} now` : ""}.</p>`
    : ""
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">You're up, ${safeName}!</h2>
    ${recalled}
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
  /** Why: removed by the host, called but didn't show, or the line closed */
  reason: "removed" | "missed" | "closed" = "removed",
  charged = false,
  isRestaurant = false,
  /** What was given back, and whether a refund the host chose didn't go through */
  money: { refundedAmount?: number; refundFailed?: boolean } = {}
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const organizer = isRestaurant ? "host" : "organizer"
  const refundedText = money.refundedAmount
    ? money.refundedAmount.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : null
  // A line closing for the night isn't a mistake to contact anyone about
  const mistake = reason === "closed" ? "" : ` If you think this was a mistake, contact the ${organizer}.`
  const subject = `You're no longer in ${lineName}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">You're no longer in line, ${safeName}</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">${reason === "missed"
      ? `You were called in <strong>${safeLine}</strong> but didn't show up in time, so your place was given to the next ${isRestaurant ? "party" : "person"}.`
      : reason === "closed"
        ? `<strong>${safeLine}</strong> has closed its line for now, so you're no longer in it. Sorry for the wait.`
        : `The ${organizer} of <strong>${safeLine}</strong> removed you from the line.`}</p>
    ${reason === "missed" && isRestaurant
      ? `<p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">Already at the host stand? Tell the host and they can add you back. Otherwise you can rejoin at the back of the line.</p>`
      : ""}
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">${money.refundFailed
      ? `The ${organizer} chose to refund your payment, but it couldn't be processed yet, so your money hasn't been returned. The ${organizer} will follow up.`
      : refunded
      ? `Your ${refundedText ? `${refundedText} ` : ""}payment for this line has been returned to you. A hold on your card is released right away; a completed charge is refunded and can take a few days to appear.`
      : charged
        ? `You've been charged for the spot you bought -- the person you bought it from gave up their place, so it isn't refunded.${mistake}`
        : mistake.trim()}</p>
  `
  return { subject, html: wrapTemplate(subject, body, "View Line", lineUrl) }
}

export function swapOfferEmail(
  userName: string,
  lineName: string,
  offerAmount: number,
  lineUrl: string,
  /** The same person raising their pending offer, not a second bidder */
  raisedFrom?: number
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" })
  const formattedAmount = usd(offerAmount)
  const subject = raisedFrom != null
    ? `Offer raised to ${formattedAmount} (was ${usd(raisedFrom)}) in ${lineName}`
    : `New swap offer: ${formattedAmount} in ${lineName}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">${raisedFrom != null ? `Your offer was raised, ${safeName}` : `New swap offer, ${safeName}!`}</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">${raisedFrom != null
      ? `The person behind you in <strong>${safeLine}</strong> raised their offer from ${usd(raisedFrom)} to <strong>${formattedAmount}</strong>.`
      : `Someone offered <strong>${formattedAmount}</strong> to swap positions with you in <strong>${safeLine}</strong>.`} If you accept, you'd receive ${formattedAmount} and move back one spot.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Accept or decline it within ${OFFER_TTL_MS / 3_600_000} hours -- after that it expires and nothing changes. It also lapses if either of you is called first.</p>
  `
  return { subject, html: wrapTemplate(subject, body, "View Offer", lineUrl) }
}

export interface SwapAcceptedOptions {
  /** The offerer still has to pay; minutes before the accepted swap lapses */
  payWithinMinutes?: number
  /** What the offerer will be charged, fees included */
  amount?: number
}

export function swapAcceptedEmail(
  userName: string,
  lineName: string,
  lineUrl: string,
  opts: SwapAcceptedOptions = {}
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const mustPay = !!opts.payWithinMinutes
  const formattedAmount = opts.amount?.toLocaleString("en-US", { style: "currency", currency: "USD" })
  const subject = mustPay
    ? `Offer accepted in ${lineName} -- pay within ${opts.payWithinMinutes} min to swap`
    : `Your swap offer was accepted in ${lineName}`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">Offer accepted, ${safeName}!</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">Your swap offer in <strong>${safeLine}</strong> has been accepted.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">${mustPay
      ? `Open the line and pay${formattedAmount ? ` <strong>${formattedAmount}</strong>` : ""} within <strong>${opts.payWithinMinutes} minutes</strong> to take their place. If you don't, the offer is closed, you keep your current spot, and you aren't charged.`
      : "You've traded places with them -- open the line to see your new position."}</p>
  `
  return { subject, html: wrapTemplate(subject, body, mustPay ? "Pay and Swap" : "Go to Line", lineUrl) }
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
  browseUrl: string,
  isRestaurant = false
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  // "Deleted", not "closed": closing for the night reads almost the same,
  // and a guest needs to know this line isn't coming back
  const subject = `${lineName} has been deleted`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">This line has been deleted, ${safeName}</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">The ${isRestaurant ? "host" : "organizer"} deleted <strong>${safeLine}</strong>, so your place in it is gone and it won't reopen.</p>
    ${hadPurchase
      ? `<p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Any payment you made to move up in this line has been returned to you. A hold on your card is released right away; a completed charge is refunded and can take a few days to appear.</p>`
      : ""}
  `
  return { subject, html: wrapTemplate(subject, body, "Browse Other Lines", browseUrl) }
}

/**
 * The seller was told "you're paid once it's collected"; when the buyer is
 * refunded instead, that payout never comes and they'd otherwise never know.
 */
export function saleReversedEmail(
  userName: string,
  lineName: string,
  amount: number,
  lineUrl: string,
  isRestaurant = false
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const formattedAmount = amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
  const subject = `The ${formattedAmount} sale of your spot in ${lineName} was cancelled`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">A sale was cancelled, ${safeName}</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">The ${isRestaurant ? "host" : "organizer"} of <strong>${safeLine}</strong> refunded the buyer of your spot, so the <strong>${formattedAmount}</strong> sale won't be paid out.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Your place in line isn't affected by this.</p>
  `
  return { subject, html: wrapTemplate(subject, body, "View Line", lineUrl) }
}

/**
 * The buyer of a spot whose payment the organizer returned from the
 * settlement page (they'd left or been cleared). A refund showing up on a
 * card days later with no word is how disputes start.
 */
export function buyerRefundedEmail(
  userName: string,
  lineName: string,
  amount: number,
  lineUrl: string,
  isRestaurant = false
): { subject: string; html: string } {
  const safeName = escapeHtml(userName)
  const safeLine = escapeHtml(lineName)
  const formattedAmount = amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
  const subject = `Your ${formattedAmount} payment for ${lineName} was returned`
  const body = `
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">Your payment was returned, ${safeName}</h2>
    <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">The ${isRestaurant ? "host" : "organizer"} of <strong>${safeLine}</strong> returned the <strong>${formattedAmount}</strong> you paid for a spot in line.</p>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">If the payment was only on hold, the hold is released right away. If it had been charged, the refund can take a few business days to show up on your statement.</p>
  `
  return { subject, html: wrapTemplate(subject, body, "View Line", lineUrl) }
}
