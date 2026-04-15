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

export function validateBoolean(value: unknown, name: string): string | null {
  if (value === undefined || value === null) {
    return `${name} is required`
  }
  if (typeof value !== "boolean") {
    return `${name} must be true or false`
  }
  return null
}
