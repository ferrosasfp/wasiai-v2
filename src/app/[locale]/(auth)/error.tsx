'use client'

/**
 * A-04: Error boundary for auth route group.
 * Catches unhandled errors in login, signup, forgot-password, etc.
 */

import { useEffect } from 'react'
import Link from 'next/link'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function AuthError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to console in development; replace with error tracking (Sentry) in production
    console.error('[auth] route error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
        <div className="mb-4 text-4xl">⚠️</div>
        <h2 className="mb-2 text-xl font-bold text-gray-900">Something went wrong</h2>
        <p className="mb-6 text-sm text-gray-500">
          An unexpected error occurred during authentication. Please try again.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={reset}
            className="rounded-xl bg-avax-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-xl border border-gray-200 px-6 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
          >
            Go home
          </Link>
        </div>

        {process.env.NODE_ENV === 'development' && (
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
              Error details (dev only)
            </summary>
            <pre className="mt-2 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-red-600">
              {error.message}
              {error.digest && `\nDigest: ${error.digest}`}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}
