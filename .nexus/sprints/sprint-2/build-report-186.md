# Build Report — WAS-186: Agent Key Scoping

**Issue:** WAS-186 | **Migration:** 053 | **Sprint:** 2  
**Builder:** NexusAgile v1.3  
**Date:** 2026-03-13  
**Commit:** `e997777`

---

## Waves Ejecutadas

### Wave 1 — DB Migration ✅
- Archivo creado: `supabase/migrations/053_agent_key_scoping.sql`
- Contenido: ADD COLUMN `allowed_slugs TEXT[]` + `allowed_categories TEXT[]` + GIN indexes
- **DB Push — BLOQUEADO (documentado)**
  - `bdwvrwzvsldephfibmuu` (prod): password auth failed — `cli_login_postgres` requiere DB password que no está en `.env.local`
  - `caldzjhjgctpgodldqav` (staging): schema drift — hay migraciones locales previas a la última remota, requiere `--include-all` (decisión manual)
  - La migration SQL está lista; aplicación manual requerida
- Build gate: **PASS** (no errores nuevos)

### Wave 2 — agent-keys.service.ts ✅
- Interfaz `AgentKey`: agregados `allowed_slugs: string[] | null` y `allowed_categories: string[] | null`
- Función `createAgentKey`: ahora acepta `options?: { allowed_slugs?, allowed_categories? }`
- Validación de slugs antes del INSERT (query a `agents` con `.eq('status', 'active')`)
- INSERT incluye `allowed_slugs` y `allowed_categories`
- Build gate: **PASS**

### Wave 3 — scope-check.ts ✅
- Archivo creado: `src/lib/scope-check.ts`
- Función `isAgentInScope(agentSlug, agentCategory, allowedSlugs, allowedCategories): boolean`
- Lógica OR: slugs OR categories, null/null = acceso total
- Build gate: **PASS**

### Wave 4 — compose/route.ts ✅
- Import `isAgentInScope` de `@/lib/scope-check`
- `KeyRow` actualizada: `allowed_slugs: string[] | null`, `allowed_categories: string[] | null`
- `.select()` de `agent_keys` incluye `allowed_slugs, allowed_categories`
- `AgentRow` actualizada: campo `category: string` agregado (necesario para `isAgentInScope`)
- Select de agents incluye `category`
- Scope check en el loop de validación de agentes (step [3], después de verificar existencia, antes de SSRF preflight)
- Usa `keyRow` (ya validado como non-null) en lugar de `safeKeyRow` (definido más abajo en el file)
- Respuesta 403 con `{ error, code: 'scope_violation', slug }` en violación
- Build gate: **PASS**

### Wave 5 — Dashboard UI + GET endpoint ✅
- `src/app/[locale]/agent-keys/page.tsx`:
  - Interfaz local `AgentKey` actualizada con `allowed_slugs` y `allowed_categories`
  - UI: badge "Acceso total" si ambos null, slugs en blue tags, categories en purple tags
- `src/app/api/v1/agent-keys/me/route.ts`:
  - Select actualizado para incluir `allowed_slugs, allowed_categories`
- Build gate: **PASS**

---

## Build Gate Final

```
npx tsc --noEmit → 5 errores pre-existentes en .next/types/validator.ts (rutas internas no encontradas)
Errores nuevos de WAS-186: 0
```

**PASS** ✅

---

## Commit

```
e997777 feat(WAS-186): agent key scoping — allowed_slugs/categories + isAgentInScope + compose scope check
```

## Archivos Cambiados

| Archivo | Tipo |
|---------|------|
| `supabase/migrations/053_agent_key_scoping.sql` | NUEVO |
| `src/lib/scope-check.ts` | NUEVO |
| `src/features/agent-api/services/agent-keys.service.ts` | MODIFICADO |
| `src/app/api/v1/compose/route.ts` | MODIFICADO |
| `src/app/[locale]/agent-keys/page.tsx` | MODIFICADO |
| `src/app/api/v1/agent-keys/me/route.ts` | MODIFICADO |

---

## Discrepancias Encontradas

1. **`AgentRow` sin campo `category`**: El SDD llama `isAgentInScope(agent.slug, agent.category, ...)` pero `AgentRow` en `compose/route.ts` no tenía el campo `category`. Se agregó `category: string` a la interfaz y al `.select()` de agents. Decisión mínima necesaria para implementar el SDD — no es un feature nuevo.

2. **`safeKeyRow` vs `keyRow`**: El SDD menciona `safeKeyRow` pero ese alias se define en línea ~295, posterior al loop de validación de agentes (~228). Se usó `keyRow` directamente (ya validado como non-null en el bloque [1] AUTH).

3. **DB Push bloqueado en ambos entornos**: La migration SQL existe y es correcta. El push requiere intervención manual (proporcionar DB password para prod, revisar schema drift en staging).

4. **Última migration local es 051**, no 052. Se creó 053 directamente según el SDD — no hay conflicto.
