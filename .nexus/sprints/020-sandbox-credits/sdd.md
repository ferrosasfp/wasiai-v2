# SDD NNN-020 — WAS-75: Sandbox Gratuito
**Sprint:** 15 | **Fase:** F2 — Software Design Document  
**Autor:** Architect (NexusAgil) | **Fecha:** 2026-03-02  
**Estado:** DRAFT

---

## 1. Contexto

### Qué existe
- `POST /api/v1/compose` requiere API key con balance (x402 flow)
- `agent_calls` tabla registra todas las llamadas — columna `is_trial BOOLEAN`
- Rate limiting via Upstash Redis en `src/lib/ratelimit.ts` — patrón `rl:{scope}:{id}`
- No existe flujo de invocación gratuita/sandbox

### Qué falta
- Tabla `sandbox_credits`: balance USDC gratuito por usuario
- Columna `payment_type` en `agent_calls` para distinguir x402 vs sandbox
- Endpoint `POST /api/v1/sandbox/invoke/[slug]` — invoke sin x402, deduce del balance
- Rate limit Redis: `rl:sandbox:{userId}` — 10 calls/hora
- Página UI: `src/app/[locale]/sandbox/page.tsx`
- Migración `032_sandbox_credits.sql`

---

## 2. Archivos a crear/modificar

| Acción | Path |
|--------|------|
| CREAR | `supabase/migrations/032_sandbox_credits.sql` |
| CREAR | `src/app/api/v1/sandbox/invoke/[slug]/route.ts` |
| CREAR | `src/app/[locale]/sandbox/page.tsx` |
| MODIFICAR | `supabase/migrations/032_sandbox_credits.sql` (columna `payment_type` en `agent_calls`) |

> Nota: ambos cambios van en la misma migración `032`.

---

## 3. Migración `032_sandbox_credits.sql`

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

-- RLS: solo el owner puede leer su balance
ALTER TABLE sandbox_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_sandbox_credits" ON sandbox_credits
  FOR ALL USING (auth.uid() = user_id);

-- Columna payment_type en agent_calls
ALTER TABLE agent_calls
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'x402'
  CHECK (payment_type IN ('x402', 'sandbox'));

-- Función para deducir balance sandbox (atómica, evita race condition)
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

## 4. Interfaces TypeScript

```typescript
// POST /api/v1/sandbox/invoke/[slug] — Request body
interface SandboxInvokeRequest {
  input: Record<string, unknown> | string
}

// POST /api/v1/sandbox/invoke/[slug] — Response 200
interface SandboxInvokeResponse {
  result: unknown
  cost_usdc: string          // cuánto se dedujo
  balance_remaining: string  // balance después de la llamada
  call_id: string
}

// Response 402 — sin créditos
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

// Row de sandbox_credits (para client-side)
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

## 5. Diseño del endpoint `POST /api/v1/sandbox/invoke/[slug]`

**Auth:** `createClient()` — usuario autenticado via sesión  
**No requiere:** API key, x402 payment

**Flujo:**
1. Auth check (`supabase.auth.getUser()`)
2. Rate limit Redis: `rl:sandbox:{user.id}` — 10/hora
   - Usar Upstash Ratelimit: `new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '1h') })`
3. Obtener agente: `agents.select('id, endpoint_url, price_per_call, status').eq('slug', slug).eq('status', 'active')`
4. Si agente no existe → 404
5. Obtener/crear fila en `sandbox_credits` para el user
   - Si no existe: `INSERT INTO sandbox_credits (user_id) VALUES ($1) ON CONFLICT DO NOTHING`
6. Verificar balance: `balance_usdc >= agent.price_per_call`
   - Si no: 402 con `{ balance_usdc, required_usdc }`
7. Llamar `deduct_sandbox_balance(user_id, price_per_call)` via `supabase.rpc()`
   - Si retorna false: 402 (race condition protegida)
8. Llamar agente externo: `fetch(endpoint_url, { method: 'POST', body: JSON.stringify({ input }) })`
9. Registrar en `agent_calls` con `payment_type = 'sandbox'`, `is_trial = true`
10. Retornar `200 { result, cost_usdc, balance_remaining, call_id }`

**Si el agente falla:** reembolsar el balance (`UPDATE sandbox_credits SET balance_usdc = balance_usdc + amount`)

---

## 6. Página `src/app/[locale]/sandbox/page.tsx`

**MVP UI:**
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

**Componentes:**
- `SandboxInvoker` — form + resultado inline
- Fetch a `/api/v1/sandbox/invoke/[slug]` client-side
- Mostrar balance en tiempo real desde `sandbox_credits`

---

## 7. Acceptance Criteria (EARS)

| # | Formato | AC |
|---|---------|-----|
| AC-01 | WHEN | WHEN un usuario autenticado invoca `POST /api/v1/sandbox/invoke/[slug]`, SHALL deducir `price_per_call` del `balance_usdc` y retornar el resultado del agente. |
| AC-02 | IF | IF el usuario no tiene fila en `sandbox_credits`, SHALL crear una con `balance_usdc = 0.5`. |
| AC-03 | IF | IF `balance_usdc < price_per_call`, SHALL retornar `402` con `code: 'insufficient_sandbox_credits'`. |
| AC-04 | WHEN | WHEN el usuario excede 10 llamadas en 1 hora, SHALL retornar `429` con `code: 'sandbox_rate_limited'`. |
| AC-05 | WHEN | WHEN el agente externo falla, SHALL reembolsar el monto deducido y retornar `422`. |
| AC-06 | WHEN | WHEN se registra la llamada en `agent_calls`, SHALL tener `payment_type = 'sandbox'` y `is_trial = true`. |
| AC-07 | WHEN | WHEN la migración `032` se aplica, SHALL agregar la columna `payment_type` con default `'x402'` sin romper registros existentes. |

---

## 8. Dependencias entre HUs

| Dirección | HU | Detalle |
|-----------|-----|---------|
| Independiente | NNN-019 | No depende de jobs async |
| Independiente | NNN-021 | No depende de UI pipelines |
| Requiere | `deduct_key_balance` RPC pattern | Copiar patrón de `compose/route.ts` — función `deduct_sandbox_balance` análoga |

---

## 9. Constraint Directives

### OBLIGATORIO
- Función `deduct_sandbox_balance` en DB para atomicidad (evitar race condition)
- Rate limit con sliding window de 1h en Redis key `rl:sandbox:{userId}`
- Reembolso en caso de fallo del agente externo
- `payment_type DEFAULT 'x402'` para no romper registros existentes
- Migración numerada `032` — la 031 es `031_webhook_delivery_lock.sql`

### PROHIBIDO
- No usar API key para este endpoint — es sesión de usuario
- No saltarse rate limit ni asumir balance infinito
- No usar `deduct_key_balance` — crear función específica `deduct_sandbox_balance`
- No hardcodear el balance inicial (usar `DEFAULT 0.5` en migración)

---

## 10. Implementation Readiness Check

- [x] Migraciones existentes verificadas — 031 es la última, 032 es correcta
- [x] Patrón `deduct_key_balance` RPC verificado en `compose/route.ts`
- [x] Patrón Redis rate limit verificado en `src/lib/ratelimit.ts`
- [x] `agent_calls` tabla confirmada con `is_trial` y columnas existentes
- [x] `createClient()` auth pattern verificado en `jobs/[id]/route.ts`
