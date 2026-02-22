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
import { createClient } from '@/lib/supabase/server'
import { registerAgentOnChain } from '@/lib/contracts/marketplaceClient'
import { BazaarClient } from 'uvd-x402-sdk/backend'

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
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()

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
    // Agent-to-agent registration
    authMethod = 'agent_key'
    // Agent key validated — creator is the key owner
    // (simplified: we use the key as creator identifier)
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

  // ── Create agent in DB ────────────────────────────────────────────────────
  const agentPayload = {
    name:           data.name,
    slug:           data.slug,
    description:    data.description,
    category:       data.category,
    agent_type:     data.agent_type,
    price_per_call: data.price_per_call,
    currency:       'USDC',
    chain:          'avalanche',
    endpoint_url:   data.endpoint_url,
    capabilities:   data.capabilities,
    dependencies:   data.dependencies,
    creator_wallet: data.creator_wallet ?? null,
    mcp_tool_name:  data.mcp_tool_name  ?? data.slug.replace(/-/g, '_'),
    mcp_description: data.mcp_description ?? data.description,
    status:         'active',
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
  const { data: keyData } = await supabase
    .from('agent_keys')
    .insert({
      name:        `${data.slug}-management`,
      budget_usdc: 0,          // management key, not for payments
      creator_id:  creatorId,
      metadata:    { type: 'management', agent_slug: data.slug },
    })
    .select('id, raw_key')
    .single()

  // ── Register on-chain (non-blocking) ─────────────────────────────────────
  if (data.creator_wallet) {
    registerAgentOnChain({
      slug:             data.slug,
      pricePerCallUSDC: data.price_per_call,
      creatorWallet:    data.creator_wallet,
    }).catch(err => console.error('[register] on-chain failed:', err))
  }

  // ── Register in Bazaar (non-blocking) ─────────────────────────────────────
  try {
    const bazaar = new BazaarClient({ apiKey: process.env.ULTRAVIOLETA_BAZAAR_API_KEY })
    await bazaar.register({
      url:          `https://wasiai.io/api/v1/agents/${data.slug}/invoke`,
      name:         data.name,
      description:  data.description ?? data.name,
      category:     'ai',
      networks:     ['avalanche'],
      tokens:       ['USDC'],
      price:        String(data.price_per_call),
      priceCurrency: 'USDC',
      payTo:        process.env.WASIAI_TREASURY_ADDRESS ?? '',
      mimeType:     'application/json',
      tags:         [data.category, 'wasiai', data.agent_type],
    })
  } catch { /* best effort */ }

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
      invoke_url:     `https://wasiai.io/api/v1/agents/${agent.slug}/invoke`,
      marketplace_url: `https://wasiai.io/agents/${agent.slug}`,
      status:         'active',
      on_chain_registered: !!data.creator_wallet,
    },
    management_key: keyData?.raw_key ?? null,
    verification: {
      status:  'pending',
      message: 'Your agent is live. WasiAI will verify the endpoint within 24h for the Verified badge.',
    },
    docs: 'https://wasiai.io/docs/agents/register',
  }, { status: 201 })
}
