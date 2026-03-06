# Validation Report — WAS-75: Sandbox Gratuito

**Fecha:** 2026-03-02  
**Sprint:** 15 | **Épica:** Epic 15 — Sandbox & Onboarding  
**Reviewer:** Adversary + QA (San)  
**Status:** CR: CHANGES REQUIRED | QA: 9/9 PASS (con observaciones)

---

## Code Review

### Hallazgos

#### 🔴 DEBE CORREGIR #1 — Migration no idempotente en `CREATE POLICY`

**Archivo:** `supabase/migrations/032_sandbox_credits.sql:12`

```sql
CREATE POLICY "users_own_sandbox_credits" ON sandbox_credits
  FOR ALL USING (auth.uid() = user_id);
```

**Problema:** `CREATE POLICY` no tiene `IF NOT EXISTS`. Re-ejecutar la migración fallará con:  
`ERROR: policy "users_own_sandbox_credits" for table "sandbox_credits" already exists`

**Fix:**
```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'sandbox_credits'
      AND policyname = 'users_own_sandbox_credits'
  ) THEN
    CREATE POLICY "users_own_sandbox_credits" ON sandbox_credits
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;
```

O en Postgres 15+:
```sql
CREATE POLICY IF NOT EXISTS "users_own_sandbox_credits" ON sandbox_credits
  FOR ALL USING (auth.uid() = user_id);
```

---

#### 🔴 DEBE CORREGIR #2 — Duplicación de prefijo en Redis rate limit key

**Archivo:** `src/app/api/v1/sandbox/invoke/[slug]/route.ts:18-27,82`

```typescript
// route.ts:18–27
let _sandboxLimit: Ratelimit | null = null
function getSandboxLimit(): Ratelimit {
  return _sandboxLimit ??= new Ratelimit({
    ...
    prefix: 'rl:sandbox',   // ← prefijo
  })
}

// route.ts:82
await getSandboxLimit().limit(`rl:sandbox:${user.id}`)
//                              ↑ repite el prefijo
```

**Problema:** La clave Redis real resulta `rl:sandbox:rl:sandbox:{userId}` en lugar de `rl:sandbox:{userId}`. 
El rate limiter de Upstash concatena `${prefix}:${identifier}`.

**Fix:** Cambiar la llamada a:
```typescript
await getSandboxLimit().limit(user.id)
// → Redis key: rl:sandbox:{userId}  ✅
```

---

#### 🟡 SUGERENCIA — Limiter definido inline en lugar de exportarlo desde `src/lib/ratelimit.ts`

**Archivo:** `src/app/api/v1/sandbox/invoke/[slug]/route.ts:18-27`

El story y OBLIGATORIO especifican "reusar patrón de `src/lib/ratelimit.ts`". Los demás limiters (invoke, compose, keys, etc.) se exportan desde ese módulo. El sandbox define su propio singleton inline, creando inconsistencia de patrón.

**Recomendación:** Agregar a `src/lib/ratelimit.ts`:
```typescript
let _sandbox: Ratelimit | null = null
export function getSandboxLimit() {
  return _sandbox ??= new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(10, '1 h'), prefix: 'rl:sandbox' })
}
```
Y en route.ts importar `getSandboxLimit` desde `@/lib/ratelimit`.

---

### Verificaciones OK

| Check | Resultado |
|-------|-----------|
| Sin `any` explícito en archivos nuevos | ✅ Confirmado — 0 ocurrencias |
| Tipos explícitos en todo el código | ✅ AgentRow, SandboxCreditsRow, interfaces completas |
| Sin duplicación con compose/route.ts | ✅ Usa `deduct_sandbox_balance` (no `deduct_key_balance`) |
| `CREATE TABLE IF NOT EXISTS` | ✅ `032_sandbox_credits.sql:3` |
| `ADD COLUMN IF NOT EXISTS` | ✅ `032_sandbox_credits.sql:21` |
| `CREATE OR REPLACE FUNCTION` | ✅ ambas funciones SQL son idempotentes |
| `createClient()` (no `createServiceClient()`) | ✅ `route.ts:13` |
| Imports via `@/lib/*` | ✅ `route.ts:13-18` |
| Reembolso atómico via RPC | ✅ `refund_sandbox_balance` RPC `route.ts:152-155` |
| `validateEndpointUrl` anti-SSRF | ✅ `route.ts:137-144` (bonus seguridad) |

---

## Quality Gate — TypeScript

```bash
npx tsc --noEmit
# → 0 errores (output vacío)
```

✅ **PASS** — Sin errores de compilación.

---

## F4 QA — Acceptance Criteria

### AC-01 — Deducción atómica + respuesta 200
> WHEN usuario autenticado invoca POST, SHALL deducir `price_per_call` atómicamente y retornar `200 { result, cost_usdc, balance_remaining, call_id }`

✅ **CUMPLE**  
- Deducción RPC: `route.ts:120` — `supabase.rpc('deduct_sandbox_balance', ...)`
- Respuesta 200: `route.ts:184-191` — `SandboxInvokeResponse` con todos los campos requeridos

---

### AC-02 — Crear fila sandbox_credits si no existe
> IF usuario sin fila en sandbox_credits, SHALL crear con `balance_usdc = 0.5`

✅ **CUMPLE**  
- Upsert con `ignoreDuplicates: true`: `route.ts:103-105`
- Default 0.5 en migración: `032_sandbox_credits.sql:5` — `DEFAULT 0.5`

---

### AC-03 — 402 si balance insuficiente
> IF `balance_usdc < price_per_call`, SHALL retornar `402 { code: 'insufficient_sandbox_credits', balance_usdc, required_usdc }`

✅ **CUMPLE**  
- Check previo: `route.ts:112-121`
- Race condition (post-deducción): `route.ts:127-136`
- Respuesta `SandboxInsufficientResponse`: `route.ts:113-120`

---

### AC-04 — Rate limit 10 llamadas/hora → 429
> WHEN excede 10 llamadas en 1 hora, SHALL retornar `429 { code: 'sandbox_rate_limited' }`

✅ **CUMPLE** (con observación)  
- Config sliding window 10/1h: `route.ts:23-24`
- Respuesta 429: `route.ts:82-89`
- ⚠️ Observación: La clave Redis real es `rl:sandbox:rl:sandbox:{userId}` por duplicación de prefijo (ver CR DEBE CORREGIR #2). Funciona pero con key incorrecta.

---

### AC-05 — Reembolso + 422 si agente falla
> WHEN agente externo falla (error o timeout), SHALL reembolsar y retornar `422`

✅ **CUMPLE**  
- Detección de fallo: `route.ts:158-165` (agente no-OK) / `route.ts:167-170` (catch)
- Reembolso RPC: `route.ts:174-177` — `supabase.rpc('refund_sandbox_balance', ...)`
- Respuesta 422: `route.ts:178`

---

### AC-06 — `agent_calls` con `payment_type = 'sandbox'` e `is_trial = true`
> WHEN se registra en agent_calls, SHALL tener `payment_type = 'sandbox'` e `is_trial = true`

✅ **CUMPLE**  
- Insert agent_calls: `route.ts:183-192`
- `is_trial: true` → `route.ts:187`
- `payment_type: 'sandbox'` → `route.ts:188`

---

### AC-07 — Migración agrega `payment_type DEFAULT 'x402'`
> WHEN migración 032 se aplica, SHALL agregar `payment_type` con `DEFAULT 'x402'` sin romper existentes

✅ **CUMPLE**  
- `032_sandbox_credits.sql:21-22`:
  ```sql
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'x402'
  CHECK (payment_type IN ('x402', 'sandbox'));
  ```

---

### AC-08 — 401 si no autenticado
> IF usuario no autenticado, SHALL retornar `401`

✅ **CUMPLE**  
- Check auth: `route.ts:72-74`
- `if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })`

---

### AC-09 — 404 si slug no existe o agente inactivo
> IF slug no corresponde a agente activo, SHALL retornar `404 { error: 'Agent not found' }`

✅ **CUMPLE**  
- Query + check: `route.ts:95-100`
- `if (agentError || !agent || agent.status !== 'active') return 404`

---

## Resumen

| Categoría | Resultado |
|-----------|-----------|
| DEBE CORREGIR | 2 |
| SUGERENCIA | 1 |
| TypeScript (`tsc --noEmit`) | ✅ 0 errores |
| ACs pasados | 9/9 |

### Decisión final

**CR: CHANGES REQUIRED** — 2 issues bloqueantes:
1. `CREATE POLICY` sin `IF NOT EXISTS` → migración no idempotente
2. Rate limit key duplicada `rl:sandbox:rl:sandbox:{userId}`

**QA: 9/9 PASS** — Todos los ACs tienen evidencia en código. Los bugs de CR afectan idempotencia de migración y precisión de key Redis, pero no bloquean el comportamiento funcional de los ACs.

---

_Generado por Adversary+QA Agent | NexusAgil | WasiAI_
