/**
 * ErrorMessage.tsx — Reusable inline error display
 *
 * T-19: Replaces the repetitive `{error && <p className="...">{error}</p>}` pattern
 *       scattered across many components.
 *
 * Usage:
 *   <ErrorMessage message={error} />
 *   <ErrorMessage message={errors.email} className="mt-2" />
 */

interface ErrorMessageProps {
  message?: string | null
  className?: string
}

export function ErrorMessage({ message, className = '' }: ErrorMessageProps) {
  if (!message) return null

  return (
    <p
      role="alert"
      aria-live="polite"
      className={`text-sm text-red-600 ${className}`}
    >
      {message}
    </p>
  )
}

/**
 * FormErrorMessage — Styled for use inside form field groups
 */
export function FormErrorMessage({ message, className = '' }: ErrorMessageProps) {
  if (!message) return null

  return (
    <p
      role="alert"
      aria-live="polite"
      className={`mt-1 text-xs text-red-500 ${className}`}
    >
      {message}
    </p>
  )
}

/**
 * AlertErrorMessage — Prominent styled error banner
 */
export function AlertErrorMessage({ message, className = '' }: ErrorMessageProps) {
  if (!message) return null

  return (
    <div
      role="alert"
      className={`rounded-xl border border-red-200 bg-red-50 px-4 py-3 ${className}`}
    >
      <p className="text-sm text-red-700">{message}</p>
    </div>
  )
}
