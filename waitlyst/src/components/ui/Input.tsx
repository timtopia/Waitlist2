import { InputHTMLAttributes, forwardRef, useId } from "react"

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", label, error, id: idProp, ...props }, ref) => {
    // A generated id when none is passed, so the label and error message
    // are still tied to the field for screen readers
    const generatedId = useId()
    const id = idProp ?? generatedId
    const errorId = error ? `${id}-error` : undefined
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={id} className="block font-mono text-xs uppercase tracking-widest text-ink/70 mb-2">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={`w-full px-3 py-2 bg-white border focus:outline-none focus:border-ink ${
            error ? "border-accent" : "border-rule"
          } ${className}`}
          {...props}
        />
        {error && <p id={errorId} className="mt-1 text-sm text-accent">{error}</p>}
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
  ({ className = "", label, error, id: idProp, ...props }, ref) => {
    // A generated id when none is passed, so the label and error message
    // are still tied to the field for screen readers
    const generatedId = useId()
    const id = idProp ?? generatedId
    const errorId = error ? `${id}-error` : undefined
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={id} className="block font-mono text-xs uppercase tracking-widest text-ink/70 mb-2">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={`w-full px-3 py-2 bg-white border focus:outline-none focus:border-ink ${
            error ? "border-accent" : "border-rule"
          } ${className}`}
          {...props}
        />
        {error && <p id={errorId} className="mt-1 text-sm text-accent">{error}</p>}
      </div>
    )
  }
)

Textarea.displayName = "Textarea"
