import { describe, it, expect } from 'vitest'
import { AGENT_PUBLIC_COLUMNS } from '../agent-columns'

// Regression guard for the 2026-07-05 security fix: `agents.webhook_secret` was
// leaking to the public anon key via `select('*')`. All anon/catalog reads now use
// AGENT_PUBLIC_COLUMNS + a column-level GRANT. If `webhook_secret` (or any future
// secret column) ever ends up in this list, the DB GRANT would re-expose it — this
// test fails loudly before that ships.
describe('AGENT_PUBLIC_COLUMNS — webhook_secret leak guard', () => {
  const cols = AGENT_PUBLIC_COLUMNS.split(',').map((c) => c.trim())

  it('never exposes webhook_secret (the anon leak that was fixed)', () => {
    expect(cols).not.toContain('webhook_secret')
  })

  it('never exposes other obvious secret-shaped columns', () => {
    for (const forbidden of ['webhook_secret', 'private_key', 'secret', 'api_key', 'signing_key']) {
      expect(cols).not.toContain(forbidden)
    }
  })

  it('still includes the columns the marketplace catalog depends on', () => {
    for (const needed of [
      'id', 'creator_id', 'slug', 'name', 'description', 'category',
      'price_per_call', 'status', 'cover_image', 'total_calls',
    ]) {
      expect(cols).toContain(needed)
    }
  })

  it('has no empty entries and no duplicates', () => {
    expect(cols.every((c) => c.length > 0)).toBe(true)
    expect(new Set(cols).size).toBe(cols.length)
  })
})
