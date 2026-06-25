/**
 * Shared fixtures + supabase-chain builders for handleInvoke behavioural tests
 * (audit 2026-06-25, P0).
 *
 * NOTE: vi.hoisted() mocks and vi.mock() factories CANNOT live here — vitest
 * requires them to be declared in the test file itself (hoisting is per-module).
 * Each test file declares its own `mocks` via vi.hoisted and calls vi.mock; this
 * module only holds plain data + chain helpers that take the test's mock object.
 */
import { vi } from 'vitest'

export interface InvokeMocks {
  agentCallsInsert:         ReturnType<typeof vi.fn>
  settlementFailuresInsert: ReturnType<typeof vi.fn>
}

export const ACTIVE_MODEL = {
  id:                 'model-uuid',
  slug:               'demo-agent',
  name:               'Demo Agent',
  status:             'active',
  endpoint_url:       'https://example.com/invoke',
  webhook_secret:     null,
  price_per_call:     0.10,
  creator_id:         'creator-uuid',
  category:           'data',
  input_schema:       null,
  max_rpd:            1000,
  max_rpm:            60,
  free_trial_enabled: false,
  free_trial_limit:   0,
  sandbox_enabled:    false,
  metadata:           null,
  capabilities:       [],
}

export const KEY_ROW = {
  id:                 'key-uuid-001',
  owner_id:           'creator-uuid',
  is_active:          true,
  key_hash:           'abc123def456',
  budget_usdc:        '10.0',
  spent_usdc:         '0.0',
  allowed_slugs:      null,
  allowed_categories: null,
}

export const AGENT_KEY = 'wai_test_key_abcdefghijklmnopqrstuvwxyz012345'

/** Chainable supabase query builder whose terminal .single() resolves `result`. */
export function makeChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  for (const m of ['select', 'eq', 'single', 'neq', 'in', 'update', 'insert', 'maybeSingle']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

/** agent_calls chain: insert() is the supplied spy, .select('id').single() returns `insertResult`. */
export function makeAgentCallsChain(
  insertSpy: ReturnType<typeof vi.fn>,
  insertResult: { data: unknown; error: unknown } = { data: { id: 'call-uuid-1' }, error: null },
) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  chain.insert = insertSpy.mockReturnValue(chain)
  chain.select = vi.fn().mockReturnValue(chain)
  chain.update = vi.fn().mockReturnValue(chain)
  chain.eq     = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue(insertResult)
  return chain
}

/** settlement_failures chain: insert() is the supplied spy, resolves OK. */
export function makeSettlementFailuresChain(insertSpy: ReturnType<typeof vi.fn>) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  chain.insert = insertSpy.mockResolvedValue({ error: null })
  return chain
}
