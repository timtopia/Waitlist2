import { InputHTMLAttributes, forwardRef } from "react"

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", label, error, id, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={id} className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={`w-full px-3 py-2 bg-white border focus:outline-none focus:border-ink ${
            error ? "border-accent" : "border-rule"
          } ${className}`}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-accent">{error}</p>}
      </div>
    )
  }
)

Input.displayName = "Input"

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = "", label, error, id, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={id} className="block font-mono text-xs uppercase tracking-widest text-ink/60 mb-2">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          className={`w-full px-3 py-2 bg-white border focus:outline-none focus:border-ink ${
            error ? "border-accent" : "border-rule"
          } ${className}`}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-accent">{error}</p>}
      </div>
    )
  }
)

Textarea.displayName = "Textarea"
