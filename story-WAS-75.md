# Story WAS-75: Sandbox Gratuito — Invocación sin x402

**Status:** ready-for-dev  
**Sprint:** 15 | **Épica:** Epic 15 — Sandbox & Onboarding  
**Prioridad:** P1 | **Estimación:** M (~4–5 horas)  
**Dependencias:** Ninguna (independiente de WAS-70 y WAS-38)

---

## Historia de usuario

Como usuario nuevo de WasiAI, quiero probar agentes gratis con un balance inicial de crédito sandbox, para evaluar el producto antes de comprar créditos reales.

---

## Contexto — qué existe hoy

| Archivo | Estado |
|---------|--------|
| `src/app/api/v1/compose/route.ts` | ✅ Existe — patrón `deduct_key_balance` RPC y auth via API key |
| `src/lib/ratelimit.ts` | ✅ Existe — patrón `rl:{scope}:{id}` con Upstash Redis |
| `supabase/migrations/031_webhook_delivery_lock.sql` | ✅ Existe — última migración, la nueva es `032` |
| `agent_calls` tabla | ✅ Existe — tiene `is_trial BOOLEAN`, **falta** `payment_type` |
| `src/app/api/v1/jobs/[id]/route.ts` | ✅ Existe — patrón `createClient()` auth a reutilizar |

**No existe** flujo de invocación gratuita. No existe tabla `sandbox_credits`.

---

## Archivos a crear/modificar

| Acción | Path |
|--------|------|
| CREAR | `supabase/migrations/032_sandbox_credits.sql` |
| CREAR | `src/app/api/v1/sandbox/invoke/[slug]/route.ts` |
| CREAR | `src/app/[locale]/sandbox/page.tsx` |
| **NO TOCAR** | `src/app/api/v1/compose/route.ts` |
| **NO TOCAR** | Ninguna migración anterior |

---

## Migración `032_sandbox_credits.sql`

```sql
-- 032_sandbox_credits.sql

-- Tabla de créditos sandbox por usuario
CREATE TABLE IF NOT EXISTS sandbox_credits (
  user_id       UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  balance_usdc  NUMERIC(18,6) NOT NULL DEFAULT 0.5,
  total_granted NUMERIC(18,6) NOT NULL DEFAULT 0.5,
  total_used    NUMERIC(18,6) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: solo el owner puede leer su propio balance
ALTER TABLE sandbox_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_sandbox_credits" ON sandbox_credits
  FOR ALL USING (auth.uid() = user_id);

-- Columna payment_type en agent_calls (sin romper registros existentes)
ALTER TABLE agent_calls
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'x402'
  CHECK (payment_type IN ('x402', 'sandbox'));

-- Función atómica para deducir balance (evita race condition)
CREATE OR REPLACE FUNCTION deduct_sandbox_balance(
  p_user_id UUID,
  p_amount  NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT balance_usdc INTO v_balance
  FROM sandbox_credits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_balance < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE sandbox_credits
  SET balance_usdc = balance_usdc - p_amount,
      total_used   = total_used + p_amount,
      updated_at   = now()
  WHERE user_id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Interfaces TypeScript

```typescript
// POST /api/v1/sandbox/invoke/[slug] — Request body
interface SandboxInvokeRequest {
  input: Record<string, unknown> | string
}

// POST /api/v1/sandbox/invoke/[slug] — Response 200
interface SandboxInvokeResponse {
  result: unknown
  cost_usdc: string          // monto deducido (string para precisión)
  balance_remaining: string  // balance después de la llamada
  call_id: string
}

// Response 402 — créditos insuficientes
interface SandboxInsufficientResponse {
  error: 'Insufficient sandbox credits'
  code: 'insufficient_sandbox_credits'
  balance_usdc: string
  required_usdc: string
}

// Response 429 — rate limit
interface SandboxRateLimitResponse {
  error: 'Rate limit exceeded'
  code: 'sandbox_rate_limited'
  limit: number
  reset_at: string
}

// Fila de sandbox_credits (para cliente)
interface SandboxCreditsRow {
  user_id: string
  balance_usdc: number
  total_granted: number
  total_used: number
  created_at: string
  updated_at: string
}
```

---

## Diseño del endpoint `POST /api/v1/sandbox/invoke/[slug]`

**Auth:** `createClient()` — usuario autenticado via sesión (NO usa API key)

**Flujo paso a paso:**

1. `supabase.auth.getUser()` → si no auth → `401`
2. Rate limit Redis: key `rl:sandbox:{user.id}`, sliding window 10 calls / 1 hora  
   ```typescript
   // Patrón de src/lib/ratelimit.ts:
   const { success, limit, reset } = await ratelimit.limit(`rl:sandbox:${user.id}`)
   if (!success) return 429 { error: 'Rate limit exceeded', code: 'sandbox_rate_limited', limit, reset_at: new Date(reset).toISOString() }
   ```
3. `supabase.from('agents').select('id, endpoint_url, price_per_call, status').eq('slug', slug).single()`  
   → Si no existe o `status !== 'active'` → `404 { error: 'Agent not found' }`
4. Obtener/crear fila sandbox_credits:  
   ```sql
   INSERT INTO sandbox_credits (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING
   ```  
   Luego `SELECT balance_usdc FROM sandbox_credits WHERE user_id = $1`
5. Verificar `balance_usdc >= agent.price_per_call`  
   → Si no: `402 { error: 'Insufficient sandbox credits', code: 'insufficient_sandbox_credits', balance_usdc, required_usdc: agent.price_per_call }`
6. `supabase.rpc('deduct_sandbox_balance', { p_user_id: user.id, p_amount: agent.price_per_call })`  
   → Si retorna `false` → `402` (race condition — balance insuficiente)
7. Llamar agente externo:  
   ```typescript
   const response = await fetch(agent.endpoint_url, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ input }),
     signal: AbortSignal.timeout(8000),
   })
   ```
8. **Si agente falla** (respuesta no-OK o timeout):  
   - Reembolsar: `UPDATE sandbox_credits SET balance_usdc = balance_usdc + $amount WHERE user_id = $1`  
   - Retornar `422 { error: 'Agent invocation failed' }`
9. Registrar en `agent_calls`:  
   `{ agent_id: agent.id, user_id: user.id, is_trial: true, payment_type: 'sandbox', cost_usdc: agent.price_per_call, ... }`
10. Obtener `balance_remaining` desde `sandbox_credits` actualizado
11. Retornar `200 { result, cost_usdc: agent.price_per_call.toString(), balance_remaining, call_id }`

---

## Página `src/app/[locale]/sandbox/page.tsx`

**Server Component** que carga datos iniciales + renderiza componente cliente `SandboxInvoker`.

```
┌─────────────────────────────────────────┐
│  🧪 Sandbox — Prueba gratis             │
│  Balance: $0.50 USDC                   │
├─────────────────────────────────────────┤
│  Seleccionar agente: [dropdown]         │
│  Input: [textarea]                      │
│  [Invocar gratis →]                     │
├─────────────────────────────────────────┤
│  Resultado:                             │
│  { ... }                                │
│  Costo deducido: $0.001 | Restante: $0.499│
└─────────────────────────────────────────┘
```

**Componentes en la página:**
- Título + balance actual (obtenido de `sandbox_credits` via server component)
- Dropdown de agentes activos (fetch a `agents` donde `status = 'active'`)
- Textarea de input
- Botón "Invocar gratis" → POST client-side a `/api/v1/sandbox/invoke/[slug]`
- Área de resultado: JSON del response
- Costo deducido y balance restante

**No se necesita componente separado en `src/components/`** — la lógica vive en la page. Si creces: extraer a `src/components/sandbox/SandboxInvoker.tsx`.

---

## Acceptance Criteria (EARS)

| # | Tipo | Criterio |
|---|------|---------|
| AC-01 | WHEN | WHEN un usuario autenticado invoca `POST /api/v1/sandbox/invoke/[slug]`, SHALL deducir `price_per_call` del `balance_usdc` atomicamente y retornar `200 { result, cost_usdc, balance_remaining, call_id }`. |
| AC-02 | IF | IF el usuario no tiene fila en `sandbox_credits`, SHALL crear una con `balance_usdc = 0.5` antes de intentar la invocación. |
| AC-03 | IF | IF `balance_usdc < price_per_call`, SHALL retornar `402 { code: 'insufficient_sandbox_credits', balance_usdc, required_usdc }`. |
| AC-04 | WHEN | WHEN el usuario excede 10 llamadas en 1 hora, SHALL retornar `429 { code: 'sandbox_rate_limited' }`. |
| AC-05 | WHEN | WHEN el agente externo falla (error o timeout), SHALL reembolsar el monto deducido y retornar `422`. |
| AC-06 | WHEN | WHEN se registra la llamada en `agent_calls`, SHALL tener `payment_type = 'sandbox'` e `is_trial = true`. |
| AC-07 | WHEN | WHEN la migración `032` se aplica, SHALL agregar `payment_type` con `DEFAULT 'x402'` sin romper registros existentes. |
| AC-08 | IF | IF el usuario no está autenticado, SHALL retornar `401`. |
| AC-09 | IF | IF el `slug` no corresponde a un agente activo, SHALL retornar `404 { error: 'Agent not found' }`. |

---

## Restricciones

### OBLIGATORIO
- Función `deduct_sandbox_balance` en DB para atomicidad (no deducir en código JS)
- Rate limit sliding window 1h, clave Redis: `rl:sandbox:{userId}` — reusar patrón de `src/lib/ratelimit.ts`
- Reembolso obligatorio si el agente externo falla
- `payment_type DEFAULT 'x402'` para no romper registros existentes en `agent_calls`
- Migración numerada `032` (031 es la última existente)
- `createClient()` para auth de usuario — NO `createServiceClient()`
- Sin `any` — tipos explícitos en todo
- Imports via `@/lib/*`, `@/app/*`, `@/components/*`

### PROHIBIDO
- No usar API key para autenticar este endpoint — es sesión de usuario
- No usar `deduct_key_balance` — crear y usar `deduct_sandbox_balance` exclusivamente
- No hardcodear el balance inicial (viene del `DEFAULT 0.5` en migración)
- No hardcodear rate limit — usar Upstash Ratelimit
- No agregar dependencias npm nuevas

---

## Definition of Done

- [ ] Migración `032_sandbox_credits.sql` aplicada: tabla `sandbox_credits` + columna `payment_type` en `agent_calls` + función `deduct_sandbox_balance` ✓
- [ ] `POST /api/v1/sandbox/invoke/[slug]` con usuario auth + balance suficiente → retorna `200` con result ✓
- [ ] Usuario sin fila en `sandbox_credits` → se crea automáticamente con $0.50 ✓
- [ ] Balance insuficiente → `402` ✓
- [ ] Rate limit 10/hora → `429` ✓
- [ ] Fallo del agente externo → reembolso + `422` ✓
- [ ] `agent_calls` registrada con `payment_type = 'sandbox'` e `is_trial = true` ✓
- [ ] Página `/[locale]/sandbox` carga con balance y lista de agentes ✓
- [ ] `npm run build` sin errores TypeScript ni ESLint ✓
- [ ] Sin `any` en el código nuevo ✓
- [ ] `git push origin master && git push origin master:main` ✓

---

## Dev Agent Record

### Agent Model Used
_(completar al implementar)_

### Completion Notes
_(completar al implementar)_

### File List
- `supabase/migrations/032_sandbox_credits.sql` — CREAR
- `src/app/api/v1/sandbox/invoke/[slug]/route.ts` — CREAR
- `src/app/[locale]/sandbox/page.tsx` — CREAR
