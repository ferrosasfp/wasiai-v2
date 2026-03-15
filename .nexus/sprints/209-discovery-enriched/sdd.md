# SDD — WAS-209: Discovery API enriquecida (v2 — post-review)

**Issue:** WAS-209  
**Clasificación:** HU-MAJOR  
**Fecha:** 2026-03-14  
**Versión:** v2 (corregido post Req Reviewer + Spec Reviewer)

---

## Correcciones post-review

| Blocker | Fix aplicado |
|---------|-------------|
| F-01: `getMarketplaceAddress()` sin args | → `getMarketplaceAddress(CHAIN_ID)` |
| F-02: columnas no en DB_SCHEMA.md | → verificadas via SQL en mainnet, confirmadas ✅ |
| F-03: tag filter client-side roto con paginación | → `.contains('tags', [tag])` server-side en Supabase |
| F-04: `identity_id` mapeado a campo incorrecto | → `creator_wallet` es la wallet address; `erc8004_id` es el token ID bigint |
| F-05: `CHAIN_NAME` = `'avalanche'` no `'avalanche-mainnet'` | → usar `CHAIN_NAME` directo, no hardcodear |
| F-06: `USDC_MAINNET` dead code | → eliminado, usar `USDC_ADDRESS` de `chain.ts` |
| Req F-02: normalización reputation no en AC | → AC-5 actualizado con nota explícita |
| Req F-03: cursor undefined | → AC-7 y código especifican cursor = base64(created_at|id) |

---

## Context

`GET /api/v1/capabilities` (WAS-208) devuelve array plano de strings. Este WAS-209 reemplaza ese handler con respuesta completa para agentes autónomos.

**Columnas verificadas en mainnet** (`agents` table):
- `slug`, `name`, `description`, `category`, `tags TEXT[]`, `price_per_call NUMERIC`
- `input_schema JSONB`, `output_schema JSONB`, `capabilities JSONB`
- `reputation_score NUMERIC(5,2)` — escala **0-100** en DB, se normaliza a **0.0-1.0** en respuesta
- `reputation_count INTEGER`, `total_calls BIGINT`
- `creator_wallet TEXT` (dirección Ethereum del creador — usada como `erc8004.identity_id`)
- `erc8004_id BIGINT` (token ID on-chain — no expuesto en este endpoint)
- `status TEXT`, `created_at TIMESTAMPTZ`, `id UUID`

**Imports reales verificados:**
- `getMarketplaceAddress(chainId: number)` → `src/lib/contracts/WasiAIMarketplace.ts:441`
- `CHAIN_ID` → número (43114 mainnet) → `src/lib/chain.ts:13`
- `CHAIN_NAME` → `'avalanche'` en mainnet → `src/lib/chain.ts:18`
- `USDC_ADDRESS` → USDC address según chain → `src/lib/chain.ts:24`

**WAS-208 se reemplaza:** mismo archivo `src/app/api/v1/capabilities/route.ts`.

---

## Acceptance Criteria (EARS)

- **AC-1:** WHEN `GET /api/v1/capabilities` sin filtros, THEN retornar todos los agentes `status='active'` con estructura enriquecida (AC-5), orden `created_at DESC, id DESC`, default limit=20.
- **AC-2:** WHEN `?tag=oracle`, THEN filtrar server-side agentes cuyo `tags` contiene `oracle` (case-insensitive via `ilike` o `.contains` con valor lowercased). IF sin resultados, THEN `{"agents":[], "total":0, "next_cursor":null}`.
- **AC-3:** WHEN `?category=defi`, THEN filtrar agentes con `category='defi'` (exact match, case-sensitive igual que valores en DB).
- **AC-4:** WHEN filtros combinados `?tag=X&category=Y&max_price=0.05&min_reputation=0.8`, THEN aplicar todos. `min_reputation=0.8` filtra `reputation_score >= 80` (DB escala 0-100).
- **AC-5:** Cada agente SHALL incluir:
  ```json
  {
    "slug": "string",
    "name": "string",
    "description": "string | null",
    "category": "string",
    "tags": ["string"],
    "price_per_call_usdc": 0.001,
    "input_schema": {} ,
    "output_schema": {},
    "invoke_url": "/api/v1/agents/{slug}/invoke",
    "erc8004": {
      "identity_id": "0x... | null",
      "reputation_score": 0.97,
      "total_invocations": 142
    },
    "payment": {
      "method": "x402",
      "asset": "USDC",
      "chain": "avalanche",
      "contract": "0x24be31..."
    }
  }
  ```
  Nota: `reputation_score` en respuesta = `agents.reputation_score / 100` (normalización 0-100 → 0.0-1.0).
- **AC-6:** Sin auth — endpoint 100% público.
- **AC-7:** WHEN resultados exceden `limit`, THEN `next_cursor` = base64(`created_at|id`) del último row. WHEN `cursor` param presente, THEN paginar desde ese punto. WHEN cursor inválido (no decodifica), THEN 400 `{"error":"invalid cursor"}`. Default `limit=20`, max `limit=100`.
- **AC-8:** Respuesta incluye `Cache-Control: public, max-age=60`.
- **AC-9:** WHEN `limit` param presente y fuera de [1,100] o no numérico, THEN 400 `{"error":"limit must be between 1 and 100"}`.

---

## Wave 0 — Pre-flight (Builder ejecuta)

- [ ] Leer `src/app/api/v1/capabilities/route.ts` — existe (WAS-208)
- [ ] Leer `src/lib/chain.ts` — verificar exports `CHAIN_ID`, `CHAIN_NAME`, `USDC_ADDRESS`
- [ ] Leer `src/lib/contracts/WasiAIMarketplace.ts` — verificar firma `getMarketplaceAddress(chainId: number)`
- [ ] Confirmar que no hay otros archivos a modificar

---

## Wave 1 — Reemplazar handler

**Archivo a sobrescribir:** `src/app/api/v1/capabilities/route.ts`

```typescript
/**
 * GET /api/v1/capabilities
 * WAS-209: Discovery API enriquecida — machine-readable con schema, pricing y ERC-8004.
 * Reemplaza WAS-208. 100% público — sin auth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMarketplaceAddress } from '@/lib/contracts/WasiAIMarketplace'
import { CHAIN_ID, CHAIN_NAME, USDC_ADDRESS } from '@/lib/chain'

export async function GET(request: NextRequest) {
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
  // AC-2: tag filter server-side using Supabase array contains
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
```

**Build gate Wave 1:**
```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit 2>&1 | grep "error TS" | head -10; echo "tsc exit: $?"
```

---

## Rollback

```bash
git show HEAD~1:src/app/api/v1/capabilities/route.ts > src/app/api/v1/capabilities/route.ts
git add src/app/api/v1/capabilities/route.ts
git commit -m "revert(WAS-209): restore WAS-208 capabilities handler"
```
Sin migraciones DB.

---

## Critical Constraints

- PROHIBIDO: auth o API key en este endpoint
- PROHIBIDO: modificar cualquier archivo fuera de `src/app/api/v1/capabilities/route.ts`
- PROHIBIDO: hardcodear dirección de contrato — usar `getMarketplaceAddress(CHAIN_ID)`
- PROHIBIDO: filtrar tags client-side — usar `.contains('tags', [tag])` server-side
- OBLIGATORIO: `reputation_score` en DB escala 0-100 → dividir entre 100 en respuesta
- OBLIGATORIO: `limit+1` fetch para detectar página siguiente sin COUNT(*)
- OBLIGATORIO: validar `limit` ANTES de usarlo
