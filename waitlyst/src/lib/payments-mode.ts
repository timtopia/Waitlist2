import { getStripe } from "./stripe"

/**
 * Without a Stripe key, trades swap spots immediately with no payment. That's
 * only for local development: a production deploy that lost its key must not
 * hand out spots for free.
 */
export function devPaymentsAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_PAYMENTS === "true"
}

/** Refuse a trade when there's no way to take payment for it */
export function paymentsUnavailable(): boolean {
  return !getStripe() && !devPaymentsAllowed()
}
