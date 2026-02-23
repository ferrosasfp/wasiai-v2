/**
 * logger.ts — Structured logger for server-side code
 *
 * S-08: Replaces raw console.log/error/warn calls with structured logging
 *       that can be captured by Vercel's log system or Sentry.
 *
 * In production: outputs JSON lines for structured log ingestion
 * In development: pretty-prints with colors for readability
 *
 * Usage:
 *   import { logger } from '@/lib/logger'
 *   logger.info('[invoke] payment settled', { txHash, amount })
 *   logger.error('[invoke] on-chain recording failed', { err })
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  data?: unknown
}

const isDev = process.env.NODE_ENV === 'development'

function log(level: LogLevel, message: string, data?: unknown): void {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(data !== undefined ? { data } : {}),
  }

  if (isDev) {
    // Pretty-print in development
    const prefix = {
      debug: '🔍',
      info:  'ℹ️ ',
      warn:  '⚠️ ',
      error: '❌',
    }[level]

    const fn = level === 'error' ? console.error
             : level === 'warn'  ? console.warn
             : console.log

    if (data !== undefined) {
      fn(`${prefix} [${level.toUpperCase()}] ${message}`, data)
    } else {
      fn(`${prefix} [${level.toUpperCase()}] ${message}`)
    }
  } else {
    // JSON structured output in production (Vercel / Sentry friendly)
    const output = JSON.stringify(entry)
    if (level === 'error') {
      process.stderr.write(output + '\n')
    } else {
      process.stdout.write(output + '\n')
    }
  }
}

export const logger = {
  debug: (message: string, data?: unknown) => log('debug', message, data),
  info:  (message: string, data?: unknown) => log('info',  message, data),
  warn:  (message: string, data?: unknown) => log('warn',  message, data),
  error: (message: string, data?: unknown) => log('error', message, data),
}
