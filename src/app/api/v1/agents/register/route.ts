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
import { probeEndpoint } from '@/lib/agents/health-probe'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { registerAgentOnChain } from '@/lib/contracts/marketplaceClient'
import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'
import { getRegisterLimit, getRegisterEmailLimit, getBootstrapLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'
import { CHAIN_NAME } from '@/lib/chain'
import { generateApiKey } from '@/features/agent-api/services/agent-keys.service'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { logger } from '@/lib/logger'

import { SITE_URL } from '@/lib/constants'
import { metaValidateSchema } from '@/lib/schema-validator'
import { buildExampleFromSchema } from '@/features/agents/utils/buildExampleFromSchema'

type JsonSchema = Parameters<typeof buildExampleFromSchema>[0]

const RegisterAgentSchema = z.object({
  // Required
  name:           z.string().min(3).max(100),
  slug:           z.string().min(3).max(80).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens'),
  endpoint_url:   z.string().url('Must be a valid HTTPS URL').optional(),  // AC8: optional → draft if absent
  // Keep in sync with agent_categories table slugs
  category:       z.enum(['nlp', 'vision', 'audio', 'code', 'multimodal', 'data', 'defi', 'defi-risk', 'security']),
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

  // WAS-200: JSON Schema draft-07 para validar inputs
  input_schema: z.record(z.string(), z.unknown()),

  // Free trial configuration
  free_trial_enabled: z.boolean().optional().default(false),
  free_trial_limit:   z.number().int().nonnegative().max(100).optional().default(1),

  // Sandbox — opt-in, creator decides
  sandbox_enabled: z.boolean().optional().default(false),
  output_schema: z.unknown().optional().nullable(),

  // WAS-212: Tags semánticos para discovery
  tags: z.array(z.string()).optional().default([]),

  // MGMT-KEY fix: creator email para open/open_key registrations
  creator_email: z.string().email().optional(),
})

async function resolveCreatorFromEmail(
  serviceClient: ReturnType<typeof createServiceClient>,
  email: string
): Promise<string | null> {
  const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomBytes(32).toString('hex'),
  })

  let userId: string | null = null

  if (!createError && newUser?.user) {
    userId = newUser.user.id
  } else if (
    createError?.message?.includes('User already registered') ||
    createError?.message?.includes('already been registered') ||
    createError?.message?.toLowerCase().includes('already exists') ||
    createError?.code === 'email_exists' ||
    createError?.code === 'user_already_exists' ||
    createError?.status === 422
  ) {
    // TODO: paginar cuando haya >1000 usuarios
    const { data: listData } = await serviceClient.auth.admin.listUsers({ perPage: 1000 })
    const existing = listData?.users?.find((u) => u.email === email)
    if (existing) userId = existing.id
  }

  if (!userId) return null

  // Safety net: asegurar creator_profile existe (trigger lo crea, esto protege edge cases)
  await serviceClient.from('creator_profiles').upsert({
    id: userId,
    username: `${email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase()}_${Date.now()}`,
    display_name: email.split('@')[0],
  }, { onConflict: 'id' })

  return userId
}

async function bootstrapAnonymousCreator(
  serviceClient: ReturnType<typeof createServiceClient>
): Promise<{ userId: string } | null> {
  const uuid = randomUUID()
  const syntheticEmail = `agent_${uuid}@bootstrap.wasiai.internal`

  // 1. Crear auth.users
  const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
    email: syntheticEmail,
    email_confirm: true,
    password: randomBytes(32).toString('hex'),
  })
  if (createError || !newUser?.user) return null

  const userId = newUser.user.id
  const baseUsername = `agent_${uuid.slice(0, 8)}`

  // 2. Insertar creator_profile con username único (hasta 3 intentos)
  let inserted = false
  for (const suffix of ['', '_2', '_3', `_${uuid}`]) {
    const username = baseUsername + suffix
    const { error } = await serviceClient
      .from('creator_profiles')
      .insert({ id: userId, username, display_name: 'Agent Publisher' })
    if (!error) { inserted = true; break }
    if (!error.message?.includes('unique') && !error.code?.includes('23505')) break // error no-recoverable
  }

  if (!inserted) {
    // Rollback auth.users
    await serviceClient.auth.admin.deleteUser(userId).catch(err =>
      console.error('[register] bootstrap rollback failed — creator_profile insert', { userId, err })
    )
    return null
  }

  return { userId }
}

export async function POST(request: NextRequest) {
  // ── Rate limiting deferred to after validation ────────────────────────────
  // Only successful DB inserts consume tokens — 422/409 validation failures do not.
  // Actual check is performed below, after Zod + slug validation.

  const supabase = await createClient()
  const serviceClient = createServiceClient()
  let isBootstrap = false

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
    // WAS-214: creator_profiles PK is `id`, not `user_id`
    const { data: ownerProfile } = await serviceClient
      .from('creator_profiles')
      .select('id, wallet_address')
      .eq('id', validKey.owner_id)
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

  // MGMT-KEY fix: resolver creator desde email para open/open_key registrations
  if ((authMethod === 'open_key' || authMethod === 'open') && !creatorId && data.creator_email) {
    creatorId = await resolveCreatorFromEmail(serviceClient, data.creator_email)
  }

  // WAS-200: Validar input_schema — requerido y debe tener al menos una propiedad
  const schemaResult = metaValidateSchema(data.input_schema)
  if (!schemaResult.valid) {
    const isSSRF = schemaResult.error?.includes('External $ref blocked')
    return NextResponse.json(
      { error: schemaResult.error, code: isSSRF ? 'schema_ssrf_blocked' : 'invalid_json_schema' },
      { status: 422 }
    )
  }
  const schemaObj = data.input_schema as Record<string, unknown>
  const schemaProps = schemaObj.properties as Record<string, unknown> | undefined
  if (!schemaProps || Object.keys(schemaProps).length === 0) {
    return NextResponse.json(
      { error: 'input_schema must define at least one property under "properties"', code: 'invalid_json_schema' },
      { status: 422 }
    )
  }

  // WAS-202: Validar output_schema si existe
  if (data.output_schema !== undefined && data.output_schema !== null) {
    const schemaResult = metaValidateSchema(data.output_schema as object)
    if (!schemaResult.valid) {
      const isSSRF = schemaResult.error?.includes('External $ref blocked')
      return NextResponse.json(
        { error: schemaResult.error, code: isSSRF ? 'schema_ssrf_blocked' : 'invalid_json_schema' },
        { status: 422 }
      )
    }
  }

  // SEC-01 + NG-005: Block SSRF via endpoint_url (only if provided)
  if (data.endpoint_url) {
    try {
      await validateEndpointUrlAsync(data.endpoint_url)
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 422 })
    }
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

  // ── Rate limiting — only counts real insert attempts (post-validation) ───
  const rlHit = await checkRateLimit(getRegisterLimit(), getIdentifier(request))
  if (rlHit) return rlHit

  // Optional: rate limit by creator_email to prevent IP-bypass
  if (data.creator_email) {
    const rlEmail = await checkRateLimit(getRegisterEmailLimit(), `email:${data.creator_email}`)
    if (rlEmail) return rlEmail
  }

  // Bootstrap anónimo: open/open_key sin creator_email → generar creator automáticamente
  if ((authMethod === 'open' || authMethod === 'open_key') && !creatorId && !data.creator_email) {
    // F1 (HIGH): Rate limit específico para bootstrap — 3 anónimos por IP por hora
    const rlBootstrap = await checkRateLimit(getBootstrapLimit(), `bootstrap:${getIdentifier(request)}`)
    if (rlBootstrap) return rlBootstrap

    let bootstrapResult: { userId: string } | null = null
    try {
      bootstrapResult = await bootstrapAnonymousCreator(serviceClient)
    } catch (err) {
      console.error('[register] bootstrapAnonymousCreator threw unexpectedly', err)
    }
    if (!bootstrapResult) {
      return NextResponse.json(
        { error: 'Registration service temporarily unavailable', code: 'bootstrap_failed' },
        { status: 503 }
      )
    }
    creatorId = bootstrapResult.userId
    isBootstrap = true
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
    webhook_secret: 'whsec_' + randomBytes(32).toString('hex'),
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
    input_schema:  data.input_schema ?? null,
    output_schema: data.output_schema ?? null,
    tags:          data.tags ?? [],
    free_trial_enabled: data.free_trial_enabled ?? false,
    free_trial_limit:   data.free_trial_limit ?? 1,
    sandbox_enabled:    data.sandbox_enabled ?? false,
    metadata: {
      registered_via: authMethod,
      framework:      data.framework,
      version:        data.version,
      erc8004_identity: data.erc8004_identity,
      auto_registered: authMethod !== 'jwt',
      input_example: data.input_schema
        ? (buildExampleFromSchema(data.input_schema as JsonSchema) ?? undefined)
        : undefined,
    },
  }

  // Use serviceClient for agent insert when no JWT session (agent_key / open auth)
  // RLS blocks anon client inserts without an active session
  const insertClient = authMethod === 'jwt' ? supabase : serviceClient
  const { data: agent, error: insertError } = await insertClient
    .from('agents')
    .insert(agentPayload)
    .select()
    .single()

  if (insertError || !agent) {
    // Slug duplicate — Postgres unique constraint
    if (insertError?.message?.includes('unique constraint') || insertError?.code === '23505') {
      if (isBootstrap && creatorId) {
        await serviceClient.auth.admin.deleteUser(creatorId).catch(err =>
          console.error('[register] bootstrap rollback failed — agent insert', { userId: creatorId, err })
        )
      }
      return NextResponse.json(
        { error: `Slug '${data.slug}' is already taken. Choose a different slug.` },
        { status: 409 },
      )
    }
    if (isBootstrap && creatorId) {
      await serviceClient.auth.admin.deleteUser(creatorId).catch(err =>
        console.error('[register] bootstrap rollback failed — agent insert', { userId: creatorId, err })
      )
    }
    return NextResponse.json(
      { error: 'Failed to create agent' },
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
      if (isBootstrap && creatorId) {
        // Delete agent first (it would be orphaned otherwise)
        try {
          await serviceClient.from('agents').delete().eq('id', agent.id)
        } catch (err) {
          console.error('[register] bootstrap rollback failed — agent delete', { agentId: agent.id, err })
        }
        // Then deleteUser (CASCADE limpia creator_profile)
        await serviceClient.auth.admin.deleteUser(creatorId).catch(err =>
          console.error('[register] bootstrap rollback failed — key insert', { userId: creatorId, err })
        )
        return NextResponse.json(
          { error: 'Registration service temporarily unavailable', code: 'bootstrap_failed' },
          { status: 503 }
        )
      }
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

  // WAS-215: Async health check — only for non-JWT auth (agent_key / open)
  // JWT creators are trusted → status stays 'active' as set in agentPayload
  if (authMethod !== 'jwt') {
    if (agent.endpoint_url) {
      await serviceClient.from('agents')
        .update({ health_check: { pending: true } })
        .eq('id', agent.id)
      // Fire-and-forget — never awaited
      probeEndpoint(agent.endpoint_url, agent.id).catch(err =>
        console.error('[register] probe failed silently', { agentId: agent.id, err: String(err) })
      )
    } else {
      // AC8: no endpoint_url → draft
      await serviceClient.from('agents')
        .update({ status: 'draft' })
        .eq('id', agent.id)
    }
  }

  return NextResponse.json({
    message: authMethod !== 'jwt' && agent.endpoint_url
      ? 'Agent registered. Verifying your endpoint... Check status_url in a few seconds.'
      : 'Agent registered successfully',
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
      status:             agent.status,
      on_chain_registered: false,
      registration_type:  (registerOnChain && data.creator_wallet) ? 'pending_onchain' : 'off_chain',
      free_trial_enabled: agent.free_trial_enabled,
      free_trial_limit:   agent.free_trial_limit,
      sandbox_enabled:    agent.sandbox_enabled,
    },
    creator_id: creatorId,
    management_key: managementKey,
    management_key_warning: managementKey ? null : 'Management key could not be issued. Contact support@wasiai.io',
    verification: {
      status:  'pending',
      message: 'Your agent is live. WasiAI will verify the endpoint within 24h for the Verified badge.',
    },
    ...(authMethod !== 'jwt' && {
      status: agent.endpoint_url ? 'reviewing' : 'draft',
    }),
    health_check: authMethod !== 'jwt'
      ? (agent.endpoint_url ? { pending: true } : null)
      : undefined,
    status_url: authMethod !== 'jwt'
      ? `GET /api/v1/agents/${agent.slug}/status`
      : undefined,
    docs: 'https://wasiai.io/docs/agents/register',
    // Bootstrap override — VA AL FINAL, sobreescribe management_key_warning:
    ...(isBootstrap && managementKey && {
      management_key_warning: 'Store this key securely. It will NOT be shown again. Recovery: POST /api/v1/agents/{slug}/recover (coming soon).',
      next_steps: {
        publish_another_agent: 'POST /api/v1/agents/register — use header: x-agent-key: <your_management_key>',
        update_this_agent: `PATCH /api/v1/agents/${data.slug} — use header: x-agent-key: <your_management_key>`,
        docs: 'https://wasiai.io/docs/agents/management-key',
      },
    }),
  }, { status: 201 })
}
