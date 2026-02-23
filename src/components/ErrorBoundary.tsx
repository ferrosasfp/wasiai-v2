'use client'

/**
 * ErrorBoundary.tsx — React error boundary component
 *
 * T-17: Wraps client components that could throw (PayToCallButton, PublishForm, etc.)
 *       to prevent the entire page from crashing on isolated component errors.
 *
 * Usage:
 *   <ErrorBoundary fallback={<p>Something went wrong</p>}>
 *     <PayToCallButton ... />
 *   </ErrorBoundary>
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Custom fallback UI. Receives the error and a reset function. */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console in dev; replace with Sentry.captureException(error, { extra: info }) in prod
    console.error('[ErrorBoundary] caught:', error, info.componentStack)
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    const { children, fallback } = this.props

    if (error) {
      if (typeof fallback === 'function') {
        return fallback(error, this.reset)
      }
      if (fallback) {
        return fallback
      }

      // Default fallback
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
          <p className="text-sm font-medium text-red-700">Something went wrong</p>
          <p className="mt-1 text-xs text-red-500">
            {process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.reset}
            className="mt-3 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition"
          >
            Try again
          </button>
        </div>
      )
    }

    return children
  }
}
