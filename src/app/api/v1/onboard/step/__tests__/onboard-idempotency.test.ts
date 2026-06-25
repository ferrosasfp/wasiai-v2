/**
 * V9 (audit 2026-06-25) — onboarding terminal step is idempotent under retry.
 *
 * Before: step 7 (agent-key flow) / step 8 (email flow) created key + agent
 * (+ user) and only THEN marked the session 'completed'. A network-timeout retry
 * of the SAME step before that update landed re-ran every side-effect → a second
 * agent + a second key (double registration).
 *
 * Now: claim_onboard_step is a row-locked CAS run BEFORE any side-effect. Exactly
 * one concurrent request wins (RPC → true) and creates the key/agent; the loser
 * (RPC → false) returns an idempotent 409 and creates nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc:            vi.fn(),
  sessionSingle:  vi.fn(),
  agentExistsSingle: vi.fn(),
  keyInsert:      vi.fn(),
  agentInsert:    vi.fn(),
  sessionUpdateEq: vi.fn(),
  keyDeleteEq:    vi.fn(),
}))

const SESSION_ID = 'sess-123'
const OWNER_ID   = 'owner-abc'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table === 'onboarding_sessions') {
        return {
          // session fetch: select('*').eq().gt().single()
          select: () => ({ eq: () => ({ gt: () => ({ single: mocks.sessionSingle }) }) }),
          // completion update: update().eq()
          update: () => ({ eq: mocks.sessionUpdateEq }),
        }
      }
      if (table === 'agents') {
        return {
          // slug-collision check: select('id').eq('slug').single()
          select: () => ({ eq: () => ({ single: mocks.agentExistsSingle }) }),
          // insert().select().single()
          insert: () => ({ select: () => ({ single: mocks.agentInsert }) }),
        }
      }
      if (table === 'agent_keys') {
        return {
          insert: mocks.keyInsert,
          delete: () => ({ eq: mocks.keyDeleteEq }),
        }
      }
      return {}
    },
  })),
}))

vi.mock('@/lib/security/validateEndpointUrl', () => ({
  validateEndpointUrlAsync: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/features/agent-api/services/agent-keys.service', () => ({
  generateApiKey: vi.fn(() => ({ raw: 'sk_raw', hash: 'hash_xyz' })),
}))
vi.mock('@/lib/chain', () => ({ CHAIN_NAME: 'avalanche-testnet' }))
vi.mock('@/features/agents/utils/buildExampleFromSchema', () => ({
  buildExampleFromSchema: vi.fn(() => ({})),
}))
vi.mock('@/lib/schema-validator', () => ({
  metaValidateSchema: vi.fn(() => ({ valid: true })),
}))
vi.mock('@/lib/api/jsonError', () => ({
  jsonError: vi.fn(() => new Response('err', { status: 400 })),
}))

import { processOnboardStep } from '../route'

/** A step-7 session in the agent-key flow (owner_id present → no email step). */
function step7Session() {
  return {
    data: {
      id: SESSION_ID,
      status: 'in_progress',
      current_step: 7,
      data: { owner_id: OWNER_ID, name: 'My Agent', category: 'nlp', price_per_call: 1 },
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    error: null,
  }
}

const validSchema = JSON.stringify({ type: 'object', properties: { x: { type: 'string' } } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sessionSingle.mockResolvedValue(step7Session())
  mocks.agentExistsSingle.mockResolvedValue({ data: null })           // no slug collision
  mocks.keyInsert.mockResolvedValue({ error: null })
  mocks.agentInsert.mockResolvedValue({ data: { id: 'agent-1', slug: 'my-agent' }, error: null })
  mocks.sessionUpdateEq.mockResolvedValue({ error: null })
  mocks.keyDeleteEq.mockResolvedValue({ error: null })
  // Default: this request wins the step claim.
  mocks.rpc.mockResolvedValue({ data: true, error: null })
})

describe('V9 — onboarding step 7 idempotency (agent-key flow)', () => {
  it('winner claims the step, creates exactly one key + one agent, completes', async () => {
    const res = await processOnboardStep(SESSION_ID, validSchema)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.completed).toBe(true)
    expect(body.agent_key).toBe('sk_raw')

    // claim ran before side-effects.
    expect(mocks.rpc).toHaveBeenCalledWith('claim_onboard_step', {
      p_session_id: SESSION_ID,
      p_step:       7,
    })
    expect(mocks.keyInsert).toHaveBeenCalledTimes(1)
    expect(mocks.agentInsert).toHaveBeenCalledTimes(1)
  })

  it('loser (claim returns false) gets 409 and creates NOTHING', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null })

    const res = await processOnboardStep(SESSION_ID, validSchema)
    expect(res.status).toBe(409)
    expect(mocks.keyInsert).not.toHaveBeenCalled()
    expect(mocks.agentInsert).not.toHaveBeenCalled()
  })

  it('two concurrent retries → only one creates key+agent (no double registration)', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: true,  error: null })  // winner
      .mockResolvedValueOnce({ data: false, error: null })  // loser

    const [r1, r2] = await Promise.all([
      processOnboardStep(SESSION_ID, validSchema),
      processOnboardStep(SESSION_ID, validSchema),
    ])

    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([200, 409])
    // Exactly one key and one agent across both concurrent retries.
    expect(mocks.keyInsert).toHaveBeenCalledTimes(1)
    expect(mocks.agentInsert).toHaveBeenCalledTimes(1)
  })

  it('releases the lock when agent creation fails, so a retry can run', async () => {
    mocks.agentInsert.mockResolvedValue({ data: null, error: { message: 'boom' } })

    const res = await processOnboardStep(SESSION_ID, validSchema)
    expect(res.status).toBe(500)
    // lock released for retry
    expect(mocks.rpc).toHaveBeenCalledWith('release_onboard_step_claim', { p_session_id: SESSION_ID })
    // key was rolled back
    expect(mocks.keyDeleteEq).toHaveBeenCalled()
  })
})
