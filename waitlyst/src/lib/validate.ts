/**
 * Input validation helpers for API routes.
 * Each function returns an error message string if invalid, or null if valid.
 */

export function validateString(
  value: unknown,
  name: string,
  opts?: { min?: number; max?: number }
): string | null {
  if (value === undefined || value === null) {
    return `${name} is required`
  }
  if (typeof value !== "string") {
    return `${name} must be a string`
  }
  const trimmed = value.trim()
  const min = opts?.min ?? 1
  const max = opts?.max
  if (trimmed.length < min) {
    if (min === 1) {
      return `${name} is required`
    }
    return `${name} must be at least ${min} characters`
  }
  if (max !== undefined && trimmed.length > max) {
    return `${name} must be ${max} characters or fewer`
  }
  return null
}

export function validateNumber(
  value: unknown,
  name: string,
  opts?: { min?: number; max?: number }
): string | null {
  if (value === undefined || value === null) {
    return `${name} is required`
  }
  if (typeof value !== "number" || isNaN(value)) {
    return `${name} must be a number`
  }
  if (opts?.min !== undefined && value < opts.min) {
    return `${name} must be at least ${opts.min}`
  }
  if (opts?.max !== undefined && value > opts.max) {
    return `${name} must be no more than ${opts.max}`
  }
  return null
}

export function validateUrl(value: unknown, name: string): string | null {
  if (value === undefined || value === null) {
    return `${name} is required`
  }
  if (typeof value !== "string") {
    return `${name} must be a string`
  }
  try {
    new URL(value)
  } catch {
    return `Please enter a valid URL for ${name}`
  }
  return null
}

/** A product image link: any https URL to an image host. */
export function validateImageUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return "Please enter a valid URL for the product image"
  }
  if (url.protocol !== "https:") return "The product image link must start with https://"
  return null
}

/**
 * Validates a client-supplied "return to this page after redirect" path
 * (e.g. for Stripe Connect onboarding). Only an internal relative path is
 * safe here -- a full URL or "//host/..." would redirect off-site after
 * Stripe hands control back to us.
 */
export function sanitizeReturnPath(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  if (!value.startsWith("/") || value.startsWith("//")) return fallback
  if (value.includes("://")) return fallback
  return value
}

export function validateBoolean(value: unknown, name: string): string | null {
  if (value === undefined || value === null) {
    return `${name} is required`
  }
  if (typeof value !== "boolean") {
    return `${name} must be true or false`
  }
  return null
}

export const MAX_NOTE_LENGTH = 140

/**
 * A party's note for the host ("high chair", "patio"). Empty means no note.
 * Returns the cleaned note, or an error to show.
 */
export function parseNote(value: unknown): string | null | { error: string } {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") return { error: "Note must be text" }
  const note = value.trim()
  if (!note) return null
  if (note.length > MAX_NOTE_LENGTH) return { error: `Notes can be at most ${MAX_NOTE_LENGTH} characters` }
  return note
}
