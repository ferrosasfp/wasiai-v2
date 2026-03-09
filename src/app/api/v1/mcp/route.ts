import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { mcpRequestSchema } from '@/lib/schemas/api.schemas'
import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'
import { logger } from '@/lib/logger'
import { getInvokeLimit, checkRateLimit } from '@/lib/ratelimit'

/**
 * WasiAI MCP Server Endpoint
 *
 * Implements the Model Context Protocol (MCP) so any AI assistant
 * (Claude Desktop, Cursor, etc.) can discover and call WasiAI agents
 * as tools — with real budget-based payment via Agent Keys.
 *
 * Setup (claude_desktop_config.json):
 *   { "mcpServers": { "wasiai": { "url": "https://app.wasiai.io/api/v1/mcp?key=wasi_YOUR_KEY" } } }
 *
 * GET  /api/v1/mcp?key=...  → Server info + tool list (free, no key needed)
 * POST /api/v1/mcp?key=...  → Execute a tool (requires valid agent key with budget)
 *
 * Supported methods:
 *   tools/list   → list all active agents as MCP tools
 *   tools/call   → call an agent, deduct from key budget, log call
 *   resources/read → wasiai://catalog — full agent list as JSON
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wrap a message as an MCP error content response */
function mcpError(message: string, status = 200) {
  return NextResponse.json(
    { content: [{ type: 'text', text: `❌ ${message}` }], isError: true },
    { status },
  )
}

/** Call the agent's upstream endpoint directly */
async function callUpstreamMcp(
  endpointUrl: string,
  input: string,
  options?: Record<string, unknown>,
): Promise<{ data: unknown; status: 'success' | 'error'; latencyMs: number }> {
  // SEC-01 + NG-005: validate endpoint to prevent SSRF (async version includes DNS probe)
  try {
    await validateEndpointUrlAsync(endpointUrl)
  } catch (err) {
    return { data: { error: 'Invalid model endpoint', detail: String(err) }, status: 'error', latencyMs: 0 }
  }

  const startMs = Date.now()
  try {
    const upstream = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, ...(options ?? {}) }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = upstream.ok ? await upstream.json() : { error: `Upstream ${upstream.status}` }
    return { data, status: upstream.ok ? 'success' : 'error', latencyMs: Date.now() - startMs }
  } catch (err) {
    return { data: { error: 'Upstream unreachable', detail: String(err) }, status: 'error', latencyMs: Date.now() - startMs }
  }
}

/** Build the tool list from active agents */
function buildTools(models: { name: string; slug: string; description: string | null; category: string; price_per_call: number; capabilities: unknown[] | null }[]) {
  return models.map(model => ({
    name: `wasiai_${model.slug.replace(/-/g, '_')}`,
    description: `[WasiAI · $${model.price_per_call}/call] ${model.description ?? model.name} (${model.category})`,
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input to send to the agent' },
        options: { type: 'object', description: 'Optional extra parameters' },
      },
      required: ['input'],
    },
  }))
}

// ── GET — Server discovery (no auth required) ─────────────────────────────────

export async function GET() {
  const supabase = createServiceClient()

  const { data: models, error } = await supabase
    .from('agents')
    .select('name, slug, description, category, price_per_call, capabilities')
    .eq('status', 'active')
    .limit(50)

  if (error) {
    logger.error('MCP GET: failed to fetch agents', { error })
    return NextResponse.json({ error: 'Failed to load agent catalog' }, { status: 500 })
  }

  return NextResponse.json({
    schema: 'mcp/server/v1',
    name: 'WasiAI',
    description:
      'AI model marketplace. Discover and call agents. Pay per call in USDC on Avalanche. ' +
      'Add ?key=wasi_YOUR_KEY to authenticate calls with your agent budget.',
    version: '1.0.0',
    tools: buildTools(models ?? []),
    resources: [
      {
        uri: 'wasiai://catalog',
        name: 'WasiAI Agent Catalog',
        description: 'Full list of available AI agents with pricing',
        mimeType: 'application/json',
      },
    ],
    auth: {
      required: 'agent_key',
      setup: 'Get a key at https://app.wasiai.io/en/agent-keys',
      usage: 'Append ?key=wasi_YOUR_KEY to the MCP server URL',
    },
  })
}

// ── POST — Execute MCP methods ────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = createServiceClient()

  // Parse body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = mcpRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid MCP request', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const { method, params } = parsed.data

  // ── tools/list ──────────────────────────────────────────────────────────────
  if (method === 'tools/list') {
    const { data: models } = await supabase
      .from('agents')
      .select('name, slug, description, category, price_per_call, capabilities')
      .eq('status', 'active')
      .limit(50)

    return NextResponse.json({ tools: buildTools(models ?? []) })
  }

  // ── resources/read ──────────────────────────────────────────────────────────
  if (method === 'resources/read') {
    const { data: models } = await supabase
      .from('agents')
      .select('name, slug, description, category, price_per_call, reputation_score, reputation_count')
      .eq('status', 'active')

    return NextResponse.json({
      contents: [
        {
          uri: 'wasiai://catalog',
          mimeType: 'application/json',
          text: JSON.stringify(models, null, 2),
        },
      ],
    })
  }

  // ── tools/call — requires agent key ────────────────────────────────────────
  if (method === 'tools/call') {
    // 1. Extract agent key from query params
    const rawKey = request.nextUrl.searchParams.get('key')

    // SEC-004: Rate limiting on tools/call
    const rlIdentifier = rawKey ? `key:${rawKey.substring(0, 24)}` : (
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'anonymous'
    )
    const rlRes = await checkRateLimit(getInvokeLimit(), `mcp:${rlIdentifier}`)
    if (rlRes) return rlRes

    if (!rawKey || !rawKey.startsWith('wasi_')) {
      return mcpError(
        'Agent key required. Add ?key=wasi_YOUR_KEY to the MCP server URL. ' +
        'Get a key at https://app.wasiai.io/en/agent-keys',
      )
    }

    // 2. Resolve tool name → agent slug
    const toolName: string = params?.name ?? ''
    const slug = toolName.replace(/^wasiai_/, '').replace(/_/g, '-')
    const input = String(params?.arguments?.['input'] ?? '')
    const options = params?.arguments?.['options'] as Record<string, unknown> | undefined

    if (!input) {
      return mcpError('`input` is required in arguments.')
    }

    // 3. Fetch agent + validate key in parallel
    const keyHash = createHash('sha256').update(rawKey).digest('hex')

    const [{ data: model, error: modelError }, { data: keyRow }] = await Promise.all([
      supabase.from('agents').select('*').eq('slug', slug).eq('status', 'active').single(),
      supabase
        .from('agent_keys')
        .select('id, is_active, budget_usdc, spent_usdc')
        .eq('key_hash', keyHash)
        .eq('is_active', true)
        .single(),
    ])

    if (modelError || !model) {
      return mcpError(`Agent '${slug}' not found on WasiAI. Check available tools with tools/list.`)
    }

    if (!keyRow) {
      return mcpError(
        'Invalid or inactive agent key. ' +
        'Verify your key at https://app.wasiai.io/en/agent-keys',
      )
    }

    // 4. Check budget
    const remaining = Number(keyRow.budget_usdc) - Number(keyRow.spent_usdc)
    if (remaining < model.price_per_call) {
      return mcpError(
        `Agent key budget exhausted. ` +
        `Remaining: $${remaining.toFixed(4)} USDC — needed: $${model.price_per_call} USDC. ` +
        `Top up at https://app.wasiai.io/en/agent-keys`,
      )
    }

    // 5. Call the agent
    const result = await callUpstreamMcp(model.endpoint_url as string, input, options)

    // 6. Deduct budget + log call (fire-and-forget safe — non-critical path)
    if (result.status === 'success') {
      await Promise.all([
        // NG-008: Atomic check+deduct — reemplaza increment_agent_key_spend
        supabase.rpc('check_and_deduct_budget', {
          p_key_id: keyRow.id,
          p_amount: model.price_per_call,
        }),
        supabase.rpc('increment_agent_stats', {
          p_agent_id: model.id,
          p_amount: model.price_per_call,
        }),
        supabase.from('agent_calls').insert({
          agent_id: model.id,
          caller_type: 'agent',
          caller_agent_id: 'mcp-client',
          amount_paid: model.price_per_call,
          tx_hash: null,
          status: 'success',
          latency_ms: result.latencyMs,
        }),
      ])
    }

    // 7. Return MCP-format result
    if (result.status === 'error') {
      return mcpError(
        `Agent call failed: ${JSON.stringify(result.data)}`,
      )
    }

    const resultText =
      typeof result.data === 'string'
        ? result.data
        : JSON.stringify(result.data, null, 2)

    return NextResponse.json({
      content: [{ type: 'text', text: resultText }],
      isError: false,
      _meta: {
        charged: model.price_per_call,
        currency: 'USDC',
        remaining_budget: parseFloat((remaining - model.price_per_call).toFixed(6)),
        latency_ms: result.latencyMs,
      },
    })
  }

  return NextResponse.json({ error: 'Unknown method', supported: ['tools/list', 'tools/call', 'resources/read'] }, { status: 400 })
}
