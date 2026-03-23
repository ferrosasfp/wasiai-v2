# SDD #092: Chat DeFi Collection — Planner Dinámico desde BD

> SPEC_APPROVED: yes
> Fecha: 2026-03-21
> Tipo: feature/improvement
> SDD_MODE: full
> Branch: feature/092-chat-defi-collection
> Sprint dir: .nexus/sprints/was-chat-defi-collection/

---

## 1. Resumen

El endpoint `/api/v1/chat` tiene los agentes disponibles hardcodeados en el `PLANNER_SYSTEM` prompt. Esto hace que agregar/quitar agentes del chat requiera deploy. Se crea una colección `defi-chat` en BD y se modifica el endpoint para generar el `PLANNER_SYSTEM` dinámicamente desde los agentes activos de esa colección.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 092 |
| **Tipo** | feature/improvement |
| **SDD_MODE** | full |
| **Objetivo** | Eliminar hardcode de agentes en chat; leerlos desde colección `defi-chat` en BD |
| **Reglas de negocio** | Solo agentes con `status='active'` Y `input_schema` válido (no null, no vacío) participan en el planner |
| **Scope IN** | Migración SQL + modificación de `route.ts` |
| **Scope OUT** | UI de administración de colecciones, API pública de colecciones, compose endpoint, autenticación del chat, `wasi-liquidity-analyzer`, `wasi-wallet-profiler` |

### Acceptance Criteria (EARS)

**AC1** — Creación de colección en BD (idempotente)
WHEN se ejecuta la migración `074_defi_chat_collection.sql`, THEN SHALL existir exactamente una fila en `collections` con `slug = 'defi-chat'`, Y SHALL existir una fila en `collection_agents` por cada uno de estos slugs: `wasi-chainlink-price`, `wasi-defi-sentiment`, `wasi-onchain-analyzer`, `wasi-contract-auditor`, `wasi-risk-report`. WHEN la migración se ejecuta más de una vez, THEN no SHALL crear duplicados ni lanzar error (usar `ON CONFLICT DO NOTHING`). IF algún slug no existe en `agents` al ejecutar la migración, THEN la migración SHALL fallar con mensaje descriptivo antes de insertar parcialmente.

**AC2** — Planner dinámico
WHEN el endpoint `POST /api/v1/chat` recibe una request, THEN SHALL consultar la BD para obtener los agentes de la colección `defi-chat` cuyo `agents.status = 'active'` antes de construir el prompt del planner. El `PLANNER_SYSTEM` hardcodeado SHALL ser eliminado del código.

**AC3** — Formato del prompt generado
WHEN la colección tiene N agentes válidos (con `input_schema` no nulo y con al menos una propiedad), THEN el prompt generado SHALL incluir para cada agente: su `slug`, su `name`, y las propiedades del `input_schema` con sus tipos, en el mismo formato que tenía el prompt hardcodeado.

**AC4** — Fallback: colección vacía o BD caída
WHEN la colección `defi-chat` no existe, o no tiene agentes activos válidos, o todos los agentes tienen `input_schema` nulo/vacío, THEN el endpoint SHALL retornar `503` con body `{ "error": "Chat service temporarily unavailable", "code": "chat_unavailable" }`. WHEN la query a BD falla (timeout, error de conexión), THEN el endpoint SHALL retornar `503` con el mismo body Y SHALL registrar el error con `console.error`.

**AC5** — Sin breaking changes en response shape
WHEN el endpoint recibe una pregunta válida con agentes disponibles, THEN el response SHALL tener exactamente la misma forma que el actual: `{ answer: string, steps: [], receipts: [], total_cost_usdc: string, pipeline_id: string }`.

**AC6** — Validación post-LLM de slugs
WHEN el LLM planner devuelve un array de steps, THEN los steps cuyos `agent_slug` no estén en la lista de slugs válidos de la colección SHALL ser filtrados antes de enviar al compose. IF todos los steps son filtrados, THEN el endpoint SHALL retornar `422` con `code: 'no_agents_matched'`.

**AC7** — Cache en memoria por instancia
WHEN se realiza la primera request al chat (cache miss), THEN la lista de agentes de la colección SHALL ser cacheada en memoria con TTL de 60 segundos. WHEN se realizan requests dentro del TTL, THEN SHALL usarse la cache sin query a BD. NOTA: Esta cache es por-instancia (in-process). En entorno serverless con múltiples instancias, el comportamiento es best-effort.

**AC8** — BD caída en runtime
WHEN la query a BD durante una request falla, THEN el endpoint SHALL retornar `503` con `code: 'chat_unavailable'` Y SHALL registrar el error con `console.error('[chat] collection query failed', error)`.

**AC9** — Agentes sin input_schema válido
WHEN un agente de la colección tiene `input_schema = null` o `input_schema` sin propiedades (`{}`), THEN ese agente SHALL ser omitido del prompt generado Y de la lista de slugs válidos para AC6. WHEN todos los agentes de la colección son omitidos por este criterio, THEN aplicar AC4 (503).

---

## 3. Context Map

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/api/v1/chat/route.ts` | Archivo a modificar | `callLLM`, `createServiceClient`, estructura del handler |
| `src/app/api/admin/collections/route.ts` | Exemplar de query collections | `supabase.from('collections').select('*, collection_agents(agent_id)')` |
| `src/lib/supabase/server.ts` | Client pattern | `createServiceClient()` — sync, no await |
| `supabase/migrations/038_collections.sql` | Schema de tablas | `collections(id, slug, name, description)`, `collection_agents(collection_id, agent_id, sort_order)` |

### Exemplars

| Para crear/modificar | Seguir patrón de | Razón |
|---------------------|------------------|-------|
| Query de colección+agentes | `src/app/api/admin/collections/route.ts` GET | Mismo patrón `select('*, collection_agents(...)')` |
| In-memory cache | Patrón singleton de `src/lib/ratelimit.ts` | Variables module-level con lazy init |
| Migration INSERT idempotente | `supabase/migrations/071_agent_categories.sql` | `INSERT ... ON CONFLICT DO NOTHING` |

### Estado de BD relevante

| Tabla | Existe | Columnas relevantes |
|-------|--------|---------------------|
| `collections` | ✅ | `id uuid PK`, `slug text UNIQUE`, `name text` |
| `collection_agents` | ✅ | `collection_id uuid FK`, `agent_id uuid FK`, `sort_order int` |
| `agents` | ✅ | `id uuid PK`, `slug text`, `status text`, `name text`, `input_schema jsonb` |

### Componentes reutilizables

- `createServiceClient()` en `src/lib/supabase/server.ts` — para query BD en route handler
- `callLLM()` en `src/lib/agents/llm` — sin cambios, se mantiene igual

---

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|----------|
| `supabase/migrations/074_defi_chat_collection.sql` | Crear | INSERT colección + agentes, idempotente | `038_collections.sql` + `071_agent_categories.sql` |
| `src/app/api/v1/chat/route.ts` | Modificar | Cache in-memory, query a BD, prompt dinámico, validación post-LLM | `src/app/api/admin/collections/route.ts` |

### 4.2 Modelo de datos

No hay cambios de schema. Solo INSERT de datos:

```sql
-- 074_defi_chat_collection.sql

-- 1. Crear colección (idempotente)
INSERT INTO collections (slug, name, description, featured, sort_order)
VALUES ('defi-chat', 'DeFi Chat', 'Agents available for the DeFi Chat beta', true, 0)
ON CONFLICT (slug) DO NOTHING;

-- 2. Insertar agentes (resolver slug → uuid primero)
-- Usar DO $$ DECLARE ... BEGIN para poder hacer SELECT + INSERT con manejo de error
DO $$
DECLARE
  col_id uuid;
  agent_slugs text[] := ARRAY[
    'wasi-chainlink-price',
    'wasi-defi-sentiment', 
    'wasi-onchain-analyzer',
    'wasi-contract-auditor',
    'wasi-risk-report'
  ];
  s text;
  a_id uuid;
BEGIN
  SELECT id INTO col_id FROM collections WHERE slug = 'defi-chat';
  -- F-4: guard contra col_id NULL (edge case)
  IF col_id IS NULL THEN
    RAISE EXCEPTION 'defi-chat collection not found after insert';
  END IF;

  FOREACH s IN ARRAY agent_slugs LOOP
    SELECT id INTO a_id FROM agents WHERE slug = s;
    IF a_id IS NULL THEN
      RAISE EXCEPTION 'Agent slug not found in agents table: %', s;
    END IF;
    INSERT INTO collection_agents (collection_id, agent_id, sort_order)
    VALUES (col_id, a_id, array_position(agent_slugs, s))
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
```

### 4.3 Arquitectura de la solución

**Cache module-level (por instancia):**
```
let _collectionCache: { agents: CollectionAgent[], expiresAt: number } | null = null
const CACHE_TTL_MS = 60_000

async function getCollectionAgents(): Promise<CollectionAgent[]>
  → cache hit → return cached
  → cache miss → query BD → cache → return
  → BD error → throw (caller maneja con 503)
```

**Query Supabase:**
```typescript
const supabase = createServiceClient()
const { data, error } = await supabase
  .from('collections')
  .select(`collection_agents(sort_order, agents(id, slug, name, input_schema, status))`)
  .eq('slug', 'defi-chat')
  .single()
```
⚠️ IMPORTANTE (F-2): supabase-js devuelve la FK `collection_agents → agents` como **objeto singular** (no array).
Acceder como `ca.agents?.slug` (NO `ca.agents[0].slug`). Puede ser null — siempre guard con `ca.agents &&`.

Filtrar: `ca.agents.status === 'active'` Y `hasValidSchema(ca.agents.input_schema)`:
```typescript
// F-6: validación exacta de input_schema
function hasValidSchema(s: unknown): boolean {
  return s !== null && typeof s === 'object' && !Array.isArray(s) && Object.keys(s as object).length > 0
}
```

**Builder del PLANNER_SYSTEM:**
```
function buildPlannerPrompt(agents: CollectionAgent[]): string
  → Para cada agente, extraer propiedades del input_schema
  → Construir línea: "- {slug}: {name} (input: {props})"
  → Inyectar en el template del prompt
```

**Validación post-LLM (F-3 — insertar ANTES del fetch a compose):**
```typescript
const validSlugs = new Set(agents.map(a => a.slug))
const filteredSteps = normalizedSteps.filter(
  (s: unknown) => validSlugs.has((s as Record<string, unknown>).agent_slug as string)
)
// Si 0 steps válidos → retornar 422 SIN llamar a compose
if (filteredSteps.length === 0) {
  return NextResponse.json(
    { error: 'I can only answer questions about DeFi and crypto on Avalanche.', code: 'no_agents_matched' },
    { status: 422 }
  )
}
// Luego: const limitedSteps = filteredSteps.slice(0, 5)
// Luego: fetch(composeUrl, { body: JSON.stringify({ steps: limitedSteps }) })
```

### 4.4 Flujo principal (Happy Path)

1. Request llega a `POST /api/v1/chat`
2. Autenticación: `x-api-key` presente → OK
3. Validar `question` (string, 1-500 chars)
4. `getCollectionAgents()` → cache hit o query BD → lista de N agentes válidos
5. `buildPlannerPrompt(agents)` → PLANNER_SYSTEM dinámico
6. `callLLM(planner)` → array de steps
7. Filtrar steps por `validSlugs`
8. `fetch(compose, { steps: limitedSteps })` 
9. `callLLM(summary)` → answer
10. Construir steps desde receipts
11. Return `{ answer, steps, receipts, total_cost_usdc, pipeline_id }`

### 4.5 Flujos de error

| Caso | Respuesta |
|------|-----------|
| Colección no existe | 503 `chat_unavailable` |
| 0 agentes activos válidos | 503 `chat_unavailable` |
| BD timeout/error | 503 `chat_unavailable` + `console.error` |
| LLM devuelve `[]` | 422 `no_agents_matched` |
| Todos los slugs filtrados post-LLM | 422 `no_agents_matched` |
| Compose falla | 502 `compose_failed` (sin cambios) |

---

## 5. Constraint Directives

### OBLIGATORIO seguir
- Patrón de query a `collections`: seguir `src/app/api/admin/collections/route.ts`
- Cache in-memory: variables module-level (mismo patrón que `src/lib/ratelimit.ts`)
- `createServiceClient()` — sin `await`, síncrono
- Migración idempotente: `INSERT ... ON CONFLICT DO NOTHING` en cada INSERT
- Migración debe usar `RAISE EXCEPTION` si un slug no existe (no inserción parcial)
- `maxDuration` en `route.ts`: mantener en 60 o subir a 90 si se detecta riesgo de timeout en cold-start

### PROHIBIDO
- NO dejar ningún string de `PLANNER_SYSTEM` hardcodeado con nombres de agentes
- NO agregar dependencias npm nuevas
- NO modificar el endpoint `/api/v1/compose`
- NO modificar la autenticación del chat (`x-api-key`)
- NO agregar `wasi-liquidity-analyzer` ni `wasi-wallet-profiler` a la colección
- NO exponer endpoint GET de la colección públicamente
- NO usar cache compartida entre procesos (Redis) — solo in-memory por instancia
- NO hacer la query a BD dentro del módulo top-level (lazy, dentro del handler o helper)

---

## 6. Scope

**IN:**
- Migración `074_defi_chat_collection.sql` — crea colección + inserta 5 agentes
- Modificación de `src/app/api/v1/chat/route.ts` — cache, query, prompt dinámico, validación slugs

**OUT:**
- UI de administración de colecciones
- API pública GET /api/v1/collections
- Compose endpoint
- Cambios de autenticación
- `wasi-liquidity-analyzer`, `wasi-wallet-profiler`
- Cache compartida (Redis)

---

## 7. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Schema del `input_schema` en BD diferente al esperado por el LLM | MEDIA | MEDIO | AC3 + QA verifica con pregunta real |
| Cold-start + query BD = timeout de 60s | BAJA | ALTO | Subir `maxDuration` a 90 si es necesario |
| Cache stale en instancias paralelas | ALTA | BAJO | Documentado en AC7 como best-effort |

---

## 8. Dependencias

- Agentes `wasi-chainlink-price`, `wasi-defi-sentiment`, `wasi-onchain-analyzer`, `wasi-contract-auditor`, `wasi-risk-report` deben existir en BD con `status='active'` antes de ejecutar la migración.

---

## 9. Waves de Implementación

### Wave 0 — Pre-flight (Builder ejecuta esto primero)
- [ ] W0.1: Verificar que los 5 slugs existen en BD con `status='active'`
- [ ] W0.2: Verificar que `collections` y `collection_agents` tienen las columnas esperadas
- [ ] W0.3: Confirmar que `074_defi_chat_collection.sql` no existe todavía
- [ ] W0.4: `npx tsc --noEmit` pasa en el estado actual del repo

### Wave 1 — Migración SQL
- [ ] W1.1: Crear `supabase/migrations/074_defi_chat_collection.sql`
- [ ] W1.2: Aplicar en prod via REST API de Supabase (INSERT directo, la migración es DML puro)
- [ ] W1.3: Verificar en BD que colección y 5 agentes existen correctamente

### Wave 2 — Código `route.ts`
- [ ] W2.1: Añadir tipos `CollectionAgent` y estructura de cache
- [ ] W2.2: Implementar `getCollectionAgents()` con cache + query + filtros
- [ ] W2.3: Implementar `buildPlannerPrompt(agents)`
- [ ] W2.4: Reemplazar `PLANNER_SYSTEM` hardcodeado por llamada a `buildPlannerPrompt`
- [ ] W2.5: Añadir validación post-LLM de slugs
- [ ] W2.6: `npx tsc --noEmit` limpio

### Wave 3 — Verificación
- [ ] W3.1: `git commit` + `git push origin main` + `git push alephhack main`
- [ ] W3.2: Esperar deploy Vercel (~2 min)
- [ ] W3.3: Test E2E: pregunta que dispara 3 agentes, verificar pipeline steps

---

## 10. Rollback

Si algo falla post-deploy:
1. `git revert HEAD` en `route.ts` → vuelve al planner hardcodeado (commit `4986fd815`)
2. La migración SQL es aditiva (solo INSERT) — no hay que revertirla, no afecta funcionalidad existente

---

*SDD generado por NexusAgile — FULL*
