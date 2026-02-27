/**
 * Analytics helpers for creator dashboard.
 * HU-1.4 / UX-06
 */

export interface DayData {
  date: string
  calls: number
}

interface CallDateRow {
  called_at: string
}

/**
 * Builds a 30-day daily call series from raw DB rows.
 * Always returns exactly 30 entries (days with no calls → calls: 0).
 * Ordered ASC by date (oldest first).
 */
export function buildDailySeries(rows: CallDateRow[] | null): DayData[] {
  const dailyMap = new Map<string, number>()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    dailyMap.set(d.toISOString().slice(0, 10), 0)
  }
  for (const row of rows ?? []) {
    const key = row.called_at.slice(0, 10)
    if (dailyMap.has(key)) dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1)
  }
  return Array.from(dailyMap.entries()).map(([date, calls]) => ({ date, calls }))
}

/**
 * Builds an empty 30-day series (all calls: 0).
 */
export function buildEmptyDailySeries(): DayData[] {
  return buildDailySeries(null)
}
