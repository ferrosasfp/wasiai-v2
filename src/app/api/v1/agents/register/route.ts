/**
 * POST /api/v1/agents/register
 *
 * Self-registration API for agents and developers.
 * An AI agent can register itself into the WasiAI marketplace programmatically.
 *
 * Auth options (one required):
 *   A) Bearer <supabase-jwt>    → human/dev registration (full trust)
 *   B) x-agent-key: wasi_xxx   → agent-to-agent registration (verified key)
 *   C) x-register-key: <key>   → open registration key (unverified, review queue)
 *
 * Flow:
 *   1. Validate input
 *   2. Check slug availability
 *   3. Insert into DB with verified=false (goes to review queue)
 *   4. Issue a management API key for the registering agent
 *   5. Try to register on-chain (non-blocking)
 *   6. Return agent + management key
 *
 * Verified vs Unverified:
 *   - Unverified: listed with badge, can receive payments immediately
 *   - Verified: WasiAI tested the endpoint, confirmed it works
 *     (manual review or automated health check)
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { registerAgentOnChain } from '@/lib/contracts/marketplaceClient'
import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'
import { getRegisterLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'
import { CHAIN_NAME } from '@/lib/chain'
import { generateApiKey } from '@/features/agent-api/services/agent-keys.service'
import { createHash } from 'crypto'
import { logger } from '@/lib/logger'

import { SITE_URL } from '@/lib/constants'

const RegisterAgentSchema = z.object({
  // Required
  name:           z.string().min(3).max(100),
  slug:           z.string().min(3).max(80).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens'),
  endpoint_url:   z.string().url('Must be a valid HTTPS URL'),
  category:       z.enum(['nlp', 'vision', 'audio', 'code', 'multimodal', 'data']),
  price_per_call: z.number().min(0.001).max(100),

  // Optional
  description:     z.string().max(500).optional(),
  agent_type:      z.enum(['model', 'agent', 'workflow']).default('agent'),
  dependencies:    z.array(z.string()).default([]),
  creator_wallet:  z.string().optional(),
  erc8004_identity: z.string().optional(),
  capabilities:    z.array(z.object({
    name:        z.string(),
    description: z.string(),
    inputType:   z.enum(['text', 'image', 'audio', 'json']),
    outputType:  z.enum(['text', 'image', 'audio', 'json']),
    example:     z.object({ input: z.string(), output: z.string() }).optional(),
  })).default([]),

  // MCP
  mcp_tool_name:   z.string().optional(),
  mcp_description: z.string().optional(),

  // Registration metadata
  framework:       z.string().optional(), // 'agentkit', 'langchain', 'custom'
  version:         z.string().optional(),

  // WAS-160b: Optional on-chain registration preference (default: true if creator_wallet present)
  register_on_chain: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  // ── Rate limiting ─────────────────────────────────────────────────────────
  const rlHit = await checkRateLimit(getRegisterLimit(), getIdentifier(request))
  if (rlHit) return rlHit

  const supabase = await createClient()
  const serviceClient = createServiceClient()

  // ── Auth ─────────────────────────────────────────────────────────────────
  let creatorId: string | null   = null
  let authMethod: string         = 'open'

  const authHeader = request.headers.get('authorization')
  const agentKey   = request.headers.get('x-agent-key')
  const regKey     = request.headers.get('x-register-key')

  if (authHeader?.startsWith('Bearer ')) {
    // Human/dev — full JWT auth
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      creatorId  = user.id
      authMethod = 'jwt'
    }
  } else if (agentKey) {
    // NG-006: Validar formato del agent key antes de procesar
    const agentKeySchema = z.string().min(32).max(128).regex(/^[a-zA-Z0-9_-]+$/)
    if (!agentKeySchema.safeParse(agentKey).success) {
      return NextResponse.json({ error: 'Invalid agent key format' }, { status: 400 })
    }
    // HAL-003: Validate agent key — MUST verify before granting access
    const hash = createHash('sha256').update(agentKey).digest('hex')
    const { data: validKey } = await serviceClient
      .from('agent_keys')
      .select('id, owner_id, is_active, budget_usdc, spent_usdc')
      .eq('key_hash', hash)
      .eq('is_active', true)
      .single()

    if (!validKey) {
      return NextResponse.json({ error: 'Invalid agent key', code: 'invalid_key' }, { status: 401 })
    }

    authMethod = 'agent_key'

    // The owner of the key is the creator of the new agent
    const { data: ownerProfile } = await serviceClient
      .from('creator_profiles')
      .select('id, wallet_address')
      .eq('user_id', validKey.owner_id)
      .single()

    if (!ownerProfile) {
      return NextResponse.json({ error: 'Creator profile not found' }, { status: 400 })
    }
    creatorId = ownerProfile.id
  } else if (regKey === process.env.OPEN_REGISTRATION_KEY) {
    authMethod = 'open_key'
  } else if (!process.env.OPEN_REGISTRATION_KEY) {
    // No key configured = fully open registration
    authMethod = 'open'
  } else {
    return NextResponse.json(
      { error: 'Authentication required. Use Authorization: Bearer <jwt>, x-agent-key, or x-register-key.' },
      { status: 401 },
    )
  }

  // ── Validate body ─────────────────────────────────────────────────────────
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = RegisterAgentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const data = parsed.data

  // SEC-01 + NG-005: Block SSRF via endpoint_url (async version includes DNS probe)
  try {
    await validateEndpointUrlAsync(data.endpoint_url)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 422 })
  }

  // ── Check slug availability ───────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('agents')
    .select('id')
    .eq('slug', data.slug)
    .single()

  if (existing) {
    return NextResponse.json(
      { error: `Slug '${data.slug}' is already taken. Choose a different slug.` },
      { status: 409 },
    )
  }

  // WAS-160b: Determine on-chain registration preference
  const registerOnChain = data.register_on_chain ?? !!data.creator_wallet

  // ── Create agent in DB ────────────────────────────────────────────────────
  const agentPayload = {
    name:           data.name,
    slug:           data.slug,
    description:    data.description,
    category:       data.category,
    agent_type:     data.agent_type,
    price_per_call: data.price_per_call,
    currency:       'USDC',
    chain:          CHAIN_NAME,
    endpoint_url:   data.endpoint_url,
    capabilities:   data.capabilities,
    dependencies:   data.dependencies,
    creator_wallet: data.creator_wallet ?? null,
    // WAS-162: Always insert as off_chain; upgrade after tx confirms
    registration_type: 'off_chain',
    mcp_tool_name:  data.mcp_tool_name  ?? data.slug.replace(/-/g, '_'),
    mcp_description: data.mcp_description ?? data.description,
    // JWT-authenticated devs go active immediately; open/agent-key registrations go to review
    status:         authMethod === 'jwt' ? 'active' : 'reviewing',
    is_featured:    false,
    creator_id:     creatorId ?? (
      // For open registration, use WasiAI's system account
      process.env.WASIAI_SYSTEM_CREATOR_ID ?? null
    ),
    metadata: {
      registered_via: authMethod,
      framework:      data.framework,
      version:        data.version,
      erc8004_identity: data.erc8004_identity,
      auto_registered: authMethod !== 'jwt',
    },
  }

  const { data: agent, error: insertError } = await supabase
    .from('agents')
    .insert(agentPayload)
    .select()
    .single()

  if (insertError || !agent) {
    return NextResponse.json(
      { error: insertError?.message ?? 'Failed to create agent' },
      { status: 500 },
    )
  }

  // ── Issue management API key ──────────────────────────────────────────────
  // So the registering agent can update/pause its own listing
  // HAL-002: Use correct columns (owner_id, key_hash) via serviceClient
  let managementKey: string | null = null
  if (creatorId) {
    const { raw, hash } = generateApiKey()
    const { error: keyInsertError } = await serviceClient
      .from('agent_keys')
      .insert({
        owner_id:    creatorId,
        name:        `${data.slug}-management`,
        key_hash:    hash,
        budget_usdc: 0,    // management key, not for payments
        spent_usdc:  0,
        is_active:   true,
      })

    if (!keyInsertError) {
      managementKey = raw  // Only shown once — caller must store it
    } else {
      logger.error('[register] management key insert failed', { keyInsertError })
    }
  }

  // ── Register on-chain (non-blocking) — WAS-162: update DB only after tx confirms ──
  if (registerOnChain && data.creator_wallet) {
    registerAgentOnChain({
      slug:             data.slug,
      pricePerCallUSDC: data.price_per_call,
      creatorWallet:    data.creator_wallet,
    })
      .then(async (txHash) => {
        if (txHash) {
          await serviceClient
            .from('agents')
            .update({
              registration_type: 'on_chain',
              on_chain_registered: true,
              chain_registered_at: new Date().toISOString(),
            })
            .eq('id', agent.id)
          logger.info('[register] on-chain confirmed, DB updated', { slug: data.slug, txHash })
        }
      })
      .catch(err => logger.error('[register] on-chain failed, agent stays off_chain', { err }))
  }

  return NextResponse.json({
    message:    'Agent registered successfully',
    verified:   false,  // verified after WasiAI review
    agent: {
      id:             agent.id,
      slug:           agent.slug,
      name:           agent.name,
      category:       agent.category,
      agent_type:     agent.agent_type,
      price_per_call: agent.price_per_call,
      invoke_url:     `${SITE_URL}/api/v1/models/${agent.slug}/invoke`,
      marketplace_url: `${SITE_URL}/en/models/${agent.slug}`,
      status:         agent.status,
      on_chain_registered: false,
      registration_type: (registerOnChain && data.creator_wallet) ? 'pending_onchain' : 'off_chain',
    },
    management_key: managementKey,
    management_key_warning: managementKey ? null : 'Management key could not be issued. Contact support@wasiai.io',
    verification: {
      status:  'pending',
      message: 'Your agent is live. WasiAI will verify the endpoint within 24h for the Verified badge.',
    },
    docs: 'https://wasiai.io/docs/agents/register',
  }, { status: 201 })
}
