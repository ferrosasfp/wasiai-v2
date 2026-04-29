/**
 * GET /api/v1/capabilities
 *
 * WAS-209: Discovery API enriquecida — machine-readable con schema, pricing y ERC-8004.
 * Reemplaza WAS-208. 100% público — sin auth.
 *
 * WKH-66: cuando `V2_DELEGATE_TO_A2A` incluye `capabilities`, este endpoint
 * reenvía a wasiai-a2a `GET /discover` (single source of truth multi-chain).
 * Cuando NO está activo, mantiene el handler legacy v2 (Supabase agents table).
 *
 * TD-002 (post WKH-66): el a2a `WasiAI` registry tiene su `discoveryEndpoint`
 * apuntando a `https://app.wasiai.io/api/v1/capabilities`. Cuando habilitamos
 * la delegación, esto produce un loop infinito (v2 → a2a → v2 → a2a → ...) que
 * resuelve con `[]` agents. Para romper el ciclo:
 *
 *   1. Si la request lleva `x-agent-key` (auth header de a2a hacia registries)
 *      y NO lleva `x-wasiai-source: v2-proxy` (i.e. no viene del proxy frontal
 *      de v2), forzamos el handler legacy. Esto deja a2a leer la lista canonical
 *      desde la tabla v2 `agents` sin volver a delegar.
 *   2. Caller externo (curl, app.wasiai.io) sigue delegado → a2a → legacy
 *      (un sólo hop de proxy, no infinito).
 *
 * El fix definitivo es reapuntar la `discoveryEndpoint` del registry a a2a
 * Railway hacia `/api/v1/agents` (legacy nunca-delegado), o exponer un
 * `/api/v1/capabilities/legacy`. Mientras tanto este loop-break es zero-risk.
 */
import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { isDelegated, forwardRequest } from '@/lib/proxy/forward-handler'
import { createClient } from '@/lib/supabase/server'
import { getMarketplaceAddress } from '@/lib/contracts/WasiAIMarketplace'
import { CHAIN_ID, CHAIN_NAME } from '@/lib/chain'

/**
 * TD-002 loop-detection. Returns `true` when the inbound request looks like
 * a2a calling back into v2 to read the `WasiAI` registry. The two markers:
 *
 *   - `x-agent-key` header is present (a2a's registry auth header).
 *   - `x-wasiai-source` is NOT `v2-proxy` (those are forwarded by the v2
 *     proxy itself; an external client never sets it).
 *
 * Both checks together avoid false-positives:
 *   - external curl: no `x-agent-key` → returns false → delegates normally.
 *   - v2-proxy frontal: sets `x-wasiai-source: v2-proxy` → returns false.
 *   - a2a registry call: has `x-agent-key`, no `x-wasiai-source` → returns true.
 */
function isA2ARegistryCallback(req: NextRequest): boolean {
  const hasAgentKey = req.headers.get('x-agent-key') !== null
  const fromV2Proxy = req.headers.get('x-wasiai-source') === 'v2-proxy'
  return hasAgentKey && !fromV2Proxy
}

/**
 * TD-002 param mapping (defense-in-depth). v2 schema uses
 * `tag` / `max_price` / `min_reputation`; a2a `/discover` uses
 * `capabilities` / `maxPrice` / `minReputation`. Without translation,
 * a2a silently ignores these filters and returns the unfiltered set.
 *
 * Mutates `searchParams` in place. Idempotent — running it twice is a noop.
 */
function translateParamsForA2A(searchParams: URLSearchParams): void {
  const renames: Array<[string, string]> = [
    ['tag', 'capabilities'],
    ['max_price', 'maxPrice'],
    ['min_reputation', 'minReputation'],
  ]
  for (const [v2Name, a2aName] of renames) {
    const value = searchParams.get(v2Name)
    if (value !== null && !searchParams.has(a2aName)) {
      searchParams.set(a2aName, value)
      searchParams.delete(v2Name)
    }
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // TD-002: break a2a → v2 → a2a recursion.
  if (isA2ARegistryCallback(req)) {
    return legacyCapabilities(req)
  }
  if (isDelegated('capabilities')) {
    // TD-002: rewrite v2-style query params into a2a's canonical names BEFORE
    // forwarding, so server-side filters actually apply on the upstream side.
    const url = new URL(req.url)
    translateParamsForA2A(url.searchParams)
    const rewritten = new NextRequest(url.toString(), req)
    return forwardRequest(rewritten, `${env.WASIAI_A2A_BASE_URL}/discover`)
  }
  return legacyCapabilities(req)
}

// ── Legacy handler ───────────────────────────────────────────────────────────
// El cuerpo legacy queda inalterado: cuando el flag esté ON el legacy nunca
// corre. Refactor de la lógica de Supabase queries está fuera de scope WKH-66.
async function legacyCapabilities(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl

  // AC-9: validate limit
  const rawLimit = searchParams.get('limit')
  if (rawLimit !== null) {
    const n = Number(rawLimit)
    if (isNaN(n) || n < 1 || n > 100) {
      return NextResponse.json(
        { error: 'limit must be between 1 and 100' },
        { status: 400 },
      )
    }
  }

  const tag           = searchParams.get('tag')?.toLowerCase() ?? null
  const category      = searchParams.get('category') ?? null
  const maxPrice      = searchParams.get('max_price') ? Number(searchParams.get('max_price')) : null
  const minReputation = searchParams.get('min_reputation') ? Number(searchParams.get('min_reputation')) : null
  const limit         = Math.min(Math.max(Number(rawLimit ?? 20), 1), 100)
  const cursor        = searchParams.get('cursor') ?? null

  const supabase = await createClient()

  let query = supabase
    .from('agents')
    .select('id, slug, name, description, category, tags, price_per_call, input_schema, output_schema, reputation_score, total_calls, creator_wallet, created_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1) // fetch one extra to detect next page

  if (category)      query = query.eq('category', category)
  if (maxPrice !== null) query = query.lte('price_per_call', maxPrice)
  // AC-4: min_reputation stored 0-100 in DB
  if (minReputation !== null) query = query.gte('reputation_score', minReputation * 100)
  // AC-2: tag filter — contains con tag lowercased (tags se almacenan en lowercase por convención)
  if (tag) query = query.contains('tags', [tag])

  // AC-7: cursor pagination
  if (cursor) {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8')
      const [cursorTs, cursorId] = decoded.split('|')
      if (!cursorTs || !cursorId) throw new Error('invalid')
      query = query.or(`created_at.lt.${cursorTs},and(created_at.eq.${cursorTs},id.lt.${cursorId})`)
    } catch {
      return NextResponse.json({ error: 'invalid cursor' }, { status: 400 })
    }
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Discovery failed' }, { status: 500 })
  }

  const rows = data ?? []
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  const lastRow = page[page.length - 1]
  const nextCursor = hasMore && lastRow
    ? Buffer.from(`${lastRow.created_at}|${lastRow.id}`).toString('base64')
    : null

  const contractAddress = getMarketplaceAddress(CHAIN_ID)

  const agents = page.map((a) => ({
    slug:                a.slug,
    name:                a.name,
    description:         a.description ?? null,
    category:            a.category,
    tags:                (a.tags as string[] | null) ?? [],
    price_per_call_usdc: Number(a.price_per_call),
    input_schema:        a.input_schema ?? null,
    output_schema:       a.output_schema ?? null,
    invoke_url:          `/api/v1/agents/${a.slug}/invoke`,
    erc8004: {
      identity_id:       a.creator_wallet ?? null,
      // AC-5: normalize 0-100 → 0.0-1.0
      reputation_score:  a.reputation_score != null ? Number(a.reputation_score) / 100 : null,
      total_invocations: Number(a.total_calls ?? 0),
    },
    payment: {
      method:   'x402',
      asset:    'USDC',
      chain:    CHAIN_NAME,
      contract: contractAddress,
    },
  }))

  return NextResponse.json(
    { agents, total: agents.length, next_cursor: nextCursor },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  )
}
