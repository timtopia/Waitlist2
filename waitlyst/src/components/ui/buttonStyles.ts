// Plain (non-client) module so server components can style a <Link> as a
// button without nesting a <button> inside an <a>.

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost"
export type ButtonSize = "sm" | "md" | "lg"

const baseStyles = "inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-accent focus:ring-ink",
  secondary: "bg-transparent text-ink border border-ink hover:bg-ink hover:text-paper focus:ring-ink",
  danger: "bg-accent text-white hover:bg-ink focus:ring-accent",
  ghost: "bg-transparent text-ink/70 hover:bg-ink/5 focus:ring-ink",
}

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm min-h-11 sm:min-h-0",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
}

export function buttonClasses({
  variant = "primary",
  size = "md",
  className = "",
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return `${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`
}
