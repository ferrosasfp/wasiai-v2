# Story File — WAS-160e: Discovery Boost On-chain

> SDD: doc/sdd/047-dual-registration/sdd.md
> Fecha: 2026-03-05
> Branch: feat/047-dual-registration
> Depende de: WAS-160a (schema — incluye RPC function `discover_agents_v2`)

---

## Goal

Modificar el endpoint `/api/v1/agents/discover` para usar la RPC function `discover_agents_v2` que ordena agentes on-chain primero, luego por `total_calls` desc.

## Acceptance Criteria (EARS)

1. WHEN el algoritmo de discovery ordena agentes, THE sistema SHALL aplicar boost de ranking a agentes on-chain sobre off-chain (con igual score base). (AC12)

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `src/app/api/v1/agents/discover/route.ts` | Modificar | Reemplazar query Supabase directa por `.rpc('discover_agents_v2', { p_category, p_max_price, p_limit })` | `037_trending_agents_rpc.sql` para patrón RPC + discover route actual |

## Exemplars

### Exemplar 1: discover/route.ts actual
**Archivo**: `src/app/api/v1/agents/discover/route.ts`
**Usar para**: Archivo #1
**Patrón clave**:
- Zod schema para query params
- `createClient()` + query builder
- `.order()` + `.limit()` + filtros condicionales
- Response: `{ agents, total, meta }`

Para RPC call pattern:
```typescript
const { data: agents, error } = await supabase.rpc('discover_agents_v2', {
  p_category: category ?? null,
  p_max_price: max_price ?? null,
  p_limit: limit,
})
```

## Constraint Directives

### OBLIGATORIO
- Usar `supabase.rpc('discover_agents_v2', ...)` — NO query builder manual
- Mantener el filtro client-side por `capability` (la RPC no lo incluye, es JSONB filter)
- Mantener estructura de response `{ agents, total, meta }` — no breaking change para consumers

### PROHIBIDO
- NO cambiar el schema de la API response (breaking change)
- NO remover filtros existentes (category, max_price, capability)
- NO agregar dependencias nuevas

## Waves

### Wave 0 (Serial Gate)
- [ ] W0.1: Verificar que `discover_agents_v2` existe en Supabase (WAS-160a migration applied)
- [ ] W0.2: Leer discover/route.ts actual

### Wave 1
- [ ] W1.1: Reemplazar query builder por `.rpc()` → Archivo #1

### Wave 2 (Verificación)
- [ ] W2.1: typecheck + build
- [ ] W2.2: Test manual: `curl /api/v1/agents/discover` — verificar on-chain agents aparecen primero

## Out of Scope

- La RPC function ya fue creada en WAS-160a migration
- Badge (WAS-160d)
- Publish flow (WAS-160b)
- Upgrade modal (WAS-160c)

## Escalation Rule

> Si algo no está en este Story File, Dev PARA y pregunta a Architect.

---

*Story File generado por NexusAgil — F2.5*
