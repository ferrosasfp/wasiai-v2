# WasiAI v2 — Guía Técnica de Soluciones por Finding

**Autor:** Auditor NexusAudit v2.0 + NexusGuard v1.0
**Fecha:** 2026-03-04
**Propósito:** Recomendaciones técnicas especializadas para cada finding, respetando el stack y golden path del proyecto.

> ⚠️ Este documento complementa `security-audit-v2-consolidated.md`.
> Cada solución está diseñada para el stack exacto de WasiAI:
> Next.js 16 + React 19 + Supabase + Viem v2 + Foundry + OpenZeppelin.

---

## Golden Path — Reglas Inmutables

Antes de implementar cualquier fix, respetar:

| Regla | Detalle |
|-------|---------|
| Sin hardcodes | Addresses, URLs, keys → siempre env vars |
| Sin ethers.js | viem v2 pinned 2.21.0 |
| Sin `NEXT_PUBLIC_` para secrets | Solo server-side |
| Zod en todo input | Runtime + compile-time validation |
| RLS activo | Todas las tablas Supabase |
| SSRF gate | `validateEndpointUrl()` antes de todo fetch externo |
| Rate limit fail-closed | Upstash down → 503, NO bypass |
| CEI pattern | En contratos: estado antes de transferencias |
| Fire-and-forget logging | DB inserts no bloquean response |
| Patrón de auth | `createServerClient()` con cookies del request |

---

## PARTE 1 — SOLUCIONES OFF-CHAIN (NexusGuard)

---

### NG-001 — OAuth Callback `x-forwarded-host` Sin Validar

**Archivo:** `src/app/[locale]/(auth)/callback/route.ts`
**Líneas:** 21-27

**Problema actual:**
```typescript
const forwardedHost = request.headers.get('x-forwarded-host');
const origin = forwardedHost
  ? `${isLocalEnv ? 'http' : 'https'}://${forwardedHost}`
  : new URL(request.url).origin;
```
El `forwardedHost` se usa directamente sin verificar que sea un dominio nuestro. Un atacante puede setear `x-forwarded-host: evil.com` en un proxy y redirigir el callback OAuth.

**Solución recomendada:**

Crear una utilidad reutilizable que valide el host contra los dominios permitidos. Esto también se reutiliza en NG-004.

```typescript
// src/lib/security/allowed-origins.ts
const ALLOWED_HOSTS = [
  process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL).host
    : null,
  'localhost:3000',
  'localhost:3001',
].filter(Boolean) as string[];

export function getSafeOrigin(request: Request): string {
  const isLocalEnv = process.env.NODE_ENV === 'development';

  // 1. Intentar x-forwarded-host (Vercel lo setea)
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost && ALLOWED_HOSTS.includes(forwardedHost)) {
    return `${isLocalEnv ? 'http' : 'https'}://${forwardedHost}`;
  }

  // 2. Fallback al origin del request
  const requestOrigin = new URL(request.url).origin;
  const requestHost = new URL(request.url).host;
  if (ALLOWED_HOSTS.includes(requestHost)) {
    return requestOrigin;
  }

  // 3. Fallback seguro: NEXT_PUBLIC_SITE_URL
  return process.env.NEXT_PUBLIC_SITE_URL || requestOrigin;
}
```

Luego en `callback/route.ts` reemplazar las líneas 21-27 por:

```typescript
import { getSafeOrigin } from '@/lib/security/allowed-origins';

// ...dentro del GET handler:
const origin = getSafeOrigin(request);
```

**Por qué esta solución:**
- Respeta el patrón existente de utilities en `src/lib/security/`
- Reutilizable para NG-004
- Allowlist desde env var (sin hardcode de dominio)
- Fallback seguro a `NEXT_PUBLIC_SITE_URL`
- Funciona con Vercel (que setea `x-forwarded-host`) y local dev

---

### NG-002 — MCP Endpoint Sin Payment/Auth Gate

**Archivo:** `src/app/api/v1/mcp/route.ts`
**Líneas:** ~119-134 (handler de `tools/call`)

**Problema actual:**
El handler `tools/call` del MCP ejecuta invocaciones a agentes pero no pasa por el pipeline de pagos x402 ni valida API key auth. Cualquier request anónimo puede invocar agentes pagos gratis.

**Contexto del stack:**
El endpoint `/api/v1/models/[slug]/invoke` tiene dos paths de pago:
- Route A: Agent Key → budget check + receipt signature
- Route B: x402 → payment header + settlement

El MCP debe usar el mismo patrón.

**Solución recomendada:**

No duplicar lógica de pagos. Extraer el pipeline compartido o que MCP haga internal fetch al invoke endpoint.

**Opción A — Internal Fetch (más limpio, respeta DRY):**

```typescript
// En el handler tools/call del MCP:
case 'tools/call': {
  const { slug, messages } = parseToolCallArgs(params);

  // Requerir agent key en MCP tool calls
  const agentKeyHeader = request.headers.get('x-agent-key');
  if (!agentKeyHeader) {
    return mcpError(-32600, 'Agent key required for tool execution. Provide x-agent-key header.');
  }

  // Proxy al invoke endpoint real (reutiliza TODA la lógica de pago)
  const invokeUrl = new URL(`/api/v1/models/${slug}/invoke`, request.url);
  const invokeResponse = await fetch(invokeUrl.toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-key': agentKeyHeader,
      'x-forwarded-for': request.headers.get('x-forwarded-for') || '',
    },
    body: JSON.stringify({ messages }),
  });

  const result = await invokeResponse.json();

  if (!invokeResponse.ok) {
    return mcpError(-32603, result.error || 'Invocation failed');
  }

  return mcpSuccess(id, { content: [{ type: 'text', text: result.response }] });
}
```

**Opción B — Shared middleware (más verbose pero directo):**

Extraer `validateAgentKeyBudget()` y `chargeAgentKey()` como funciones compartidas en `src/lib/payments/agent-key-pipeline.ts` y llamarlas tanto en invoke como en MCP.

**Recomendación:** Opción A es preferible. Es DRY, mantiene un solo punto de verdad para pagos, y no requiere refactorizar el invoke endpoint.

**Consideraciones:**
- `tools/list` y `resources/read` siguen siendo gratis (catálogo público)
- Solo `tools/call` requiere agent key
- El rate limiting ya existe en invoke, no duplicar
- La respuesta MCP debe transformar el formato de invoke → formato MCP JSON-RPC

---

### NG-003 — Cron Auth Fail-Open

**Archivo:** `src/app/api/cron/retry-recordings/route.ts`
**Líneas:** 13-21

**Problema actual:**
```typescript
const authHeader = request.headers.get('authorization');
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```
Si `CRON_SECRET` no está en env, el check compara contra `"Bearer undefined"`. En la mayoría de escenarios esto bloquea, PERO hay edge cases donde puede fallar.

**Solución recomendada:**

Guard explícito al inicio, antes de cualquier comparación:

```typescript
export async function GET(request: Request) {
  // Fail-closed: si no hay secret configurado, NUNCA permitir acceso
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[CRON] CRON_SECRET not configured — access denied');
    return NextResponse.json(
      { error: 'Server misconfiguration' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ... resto del handler
}
```

**Patrón a aplicar en TODOS los crons:**
Buscar todos los archivos en `src/app/api/cron/` y aplicar el mismo guard. Es probable que haya otros endpoints cron con el mismo patrón.

**Tip de auto-blindaje:** Documentar esta regla en `project-context.md`:
```
## Cron Security Rule
Todos los endpoints cron DEBEN validar CRON_SECRET con fail-closed:
if (!process.env.CRON_SECRET) return 500
```

---

### NG-004 — OAuth `redirectTo` Usa Raw Origin

**Archivo:** `src/actions/auth.ts`
**Líneas:** 189-196

**Problema actual:**
```typescript
const origin = headers().get('origin') || process.env.NEXT_PUBLIC_SITE_URL;
const redirectTo = `${origin}/${locale}/callback`;
```
El header `Origin` se usa sin validar, permitiendo redirección a dominios arbitrarios.

**Solución recomendada:**

Reutilizar la misma utilidad `getSafeOrigin` creada para NG-001:

```typescript
import { getSafeOrigin } from '@/lib/security/allowed-origins';

// Dentro de signInWithGoogle:
export async function signInWithGoogle(locale: string) {
  // ... validación existente de locale ...

  const supabase = await createClient();

  // Usar origin validado (NO raw header)
  // Nota: en Server Actions no tenemos el Request object,
  // así que adaptar getSafeOrigin para aceptar headers() directamente
  const headersList = await headers();
  const origin = getSafeOriginFromHeaders(headersList);
  const redirectTo = `${origin}/${locale}/callback`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });

  // ...
}
```

Agregar variante para Server Actions en `allowed-origins.ts`:

```typescript
export function getSafeOriginFromHeaders(headersList: Headers): string {
  const origin = headersList.get('origin');
  if (origin) {
    try {
      const host = new URL(origin).host;
      if (ALLOWED_HOSTS.includes(host)) return origin;
    } catch { /* invalid URL, fallback */ }
  }
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://wasiai-v2.vercel.app';
}
```

**Por qué:**
- Reutiliza la allowlist de NG-001 (DRY)
- Adaptada para el contexto de Server Actions (sin Request object)
- Fallback seguro hardcodeado como última línea de defensa

---

### NG-005 — SSRF Vulnerable a DNS Rebinding

**Archivo:** `src/lib/security/validateEndpointUrl.ts`
**Líneas:** 5-51

**Problema actual:**
La validación resuelve DNS al momento de validar, pero la conexión real puede resolver a una IP diferente (DNS rebinding). El atacante:
1. Registra agente con endpoint `https://evil.com/api` → DNS resuelve a `1.2.3.4` (público, pasa validación)
2. Cambia DNS de `evil.com` → `169.254.169.254` (AWS metadata)
3. Cuando el backend hace fetch al endpoint, resuelve la nueva IP → SSRF exitoso

**Solución recomendada:**

Implementar DNS pinning: resolver la IP al momento de validar Y forzar la conexión a esa IP específica.

```typescript
// src/lib/security/validateEndpointUrl.ts

import { isPrivateIP } from './private-ip-ranges'; // extraer la lógica de IPs privadas

interface ValidatedUrl {
  url: string;
  resolvedIP: string;
}

export async function validateEndpointUrl(url: string): Promise<ValidatedUrl> {
  // 1. Validaciones de formato existentes (scheme, length, etc.)
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }

  // 2. Resolver DNS AHORA
  const hostname = parsed.hostname;

  // Usar fetch con DNS lookup manual no es trivial en Edge Runtime.
  // Alternativa pragmática: doble-check.
  // Validar hostname contra blocklist de dominios internos
  const BLOCKED_HOSTNAMES = [
    'metadata.google.internal',
    'metadata.google.com',
    '169.254.169.254',
    'localhost',
    '127.0.0.1',
    '[::1]',
  ];

  if (BLOCKED_HOSTNAMES.some(blocked => hostname === blocked || hostname.endsWith(`.${blocked}`))) {
    throw new Error('Blocked hostname');
  }

  // 3. Hacer un HEAD request de validación para verificar que no redirige a IP privada
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const probe = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual', // NO seguir redirects automáticos
    });

    // Si hay redirect, validar la URL de destino también
    if (probe.status >= 300 && probe.status < 400) {
      const location = probe.headers.get('location');
      if (location) {
        // Recursion con profundidad limitada
        return validateEndpointUrl(location);
      }
    }
  } catch (err) {
    // Timeout o error de red — rechazar por seguridad
    throw new Error(`Endpoint validation failed: ${err instanceof Error ? err.message : 'unknown'}`);
  } finally {
    clearTimeout(timeout);
  }

  return { url, resolvedIP: hostname };
}
```

**Nota sobre Edge Runtime:**
En Vercel Edge Runtime no hay acceso a `dns.resolve()` de Node.js. La estrategia pragmática es:
1. Validar hostname contra blocklist
2. Hacer HEAD probe con `redirect: 'manual'`
3. Validar URLs de redirect recursivamente
4. No seguir redirects ciegos (previene SSRF via redirect chain)

**Consideración de rendimiento:**
El HEAD probe agrega ~100-500ms al registro de agentes. Es aceptable porque registro es una operación infrecuente (no está en hot path de invocaciones).

---

### NG-006 — Agent Key Sin Validar en Register

**Archivo:** `src/app/api/v1/agents/register/route.ts`
**Líneas:** 89-93

**Problema actual:**
El agent key del request se acepta sin validar formato. Keys con caracteres especiales pueden causar problemas en queries PostgREST o en la generación de prefijos para rate limiting.

**Solución recomendada:**

Agregar schema Zod alineado con el patrón existente del proyecto:

```typescript
// En el schema de validación del register endpoint:
const registerSchema = z.object({
  // ... campos existentes ...
  agentKey: z.string()
    .min(32, 'Agent key must be at least 32 characters')
    .max(128, 'Agent key must be at most 128 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Agent key must be alphanumeric with dashes/underscores only')
    .optional(), // opcional porque el sistema genera uno si no se provee
});
```

**Contexto:** El proyecto ya usa Zod en todos los endpoints. Esto sigue el patrón exacto. Verificar que el mismo schema se aplique en el endpoint de rotación de keys si existe.

---

### NG-007 — Reputation Voting Sin Protección Sybil

**Archivo:** `src/app/api/v1/models/[slug]/rate/route.ts`
**Líneas:** 63-66

**Problema actual:**
```typescript
const voterId = await sha256(walletAddress || ip);
```
El voterId se genera desde wallet o IP. Un atacante puede generar wallets infinitas y votar spam.

**Solución recomendada:**

Requerir que el votante tenga al menos 1 invocación exitosa al agente:

```typescript
// Antes de permitir el voto:
const { count: invocationCount } = await supabase
  .from('agent_calls')
  .select('*', { count: 'exact', head: true })
  .eq('agent_id', agent.id)
  .eq('status', 'success')
  .or(
    walletAddress
      ? `caller_address.eq.${walletAddress}`
      : `caller_ip.eq.${ip}`
  );

if (!invocationCount || invocationCount === 0) {
  return NextResponse.json(
    { error: 'Must have at least one successful invocation to rate this agent' },
    { status: 403 }
  );
}
```

**Alternativa más simple (si `agent_calls` no tiene `caller_address`):**

Validar que el votante tenga un agent key activo con al menos 1 llamada registrada:

```typescript
// Si no hay campo caller_address en agent_calls,
// requerir x-agent-key header y validar contra agent_key_stats
const agentKey = request.headers.get('x-agent-key');
if (!agentKey) {
  return NextResponse.json(
    { error: 'Agent key required to rate. Must have used this agent.' },
    { status: 401 }
  );
}

const { data: keyData } = await supabase
  .from('agent_keys')
  .select('id, total_calls')
  .eq('key_prefix', agentKey.substring(0, 24))
  .eq('agent_id', agent.id)
  .single();

if (!keyData || keyData.total_calls === 0) {
  return NextResponse.json(
    { error: 'Must have at least one call to this agent to rate it' },
    { status: 403 }
  );
}
```

**Migración SQL (si se elige Opción 1):**
Agregar columna `caller_address` a `agent_calls` si no existe:
```sql
ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS caller_address text;
CREATE INDEX IF NOT EXISTS idx_agent_calls_caller ON agent_calls(agent_id, caller_address);
```

---

### NG-008 — Race Condition en Budget Check de Agent Key

**Archivo:** `src/app/api/v1/models/[slug]/invoke/route.ts`
**Líneas:** 170-195

**Problema actual:**
El budget check es un SELECT seguido de UPDATE separados. Dos requests concurrentes pueden pasar el check antes de que se decremente el budget.

**Contexto del stack:**
El proyecto usa Supabase con funciones RPC (`increment_agent_key_spend`). Ya existe un patrón de RPC.

**Solución recomendada:**

Crear una función RPC atómica que haga check + decrement en una sola operación SQL:

```sql
-- Migración: create_atomic_budget_check.sql
CREATE OR REPLACE FUNCTION check_and_deduct_budget(
  p_key_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance numeric;
  v_budget_limit numeric;
  v_current_spend numeric;
BEGIN
  -- Lock the row to prevent concurrent reads
  SELECT budget_limit, total_spend
  INTO v_budget_limit, v_current_spend
  FROM agent_keys
  WHERE id = p_key_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Key not found');
  END IF;

  v_current_balance := v_budget_limit - v_current_spend;

  IF v_current_balance < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient budget',
      'remaining', v_current_balance
    );
  END IF;

  -- Atomic deduction
  UPDATE agent_keys
  SET total_spend = total_spend + p_amount,
      total_calls = total_calls + 1,
      last_used_at = now()
  WHERE id = p_key_id;

  RETURN jsonb_build_object(
    'success', true,
    'remaining', v_current_balance - p_amount
  );
END;
$$;
```

En el invoke endpoint, reemplazar el SELECT + UPDATE por:

```typescript
const { data: budgetResult } = await supabase
  .rpc('check_and_deduct_budget', {
    p_key_id: keyData.id,
    p_amount: totalPrice,
  });

if (!budgetResult?.success) {
  return NextResponse.json(
    { error: budgetResult?.error || 'Budget check failed' },
    { status: 402 }
  );
}
```

**Por qué esta solución:**
- `FOR UPDATE` en PostgreSQL bloquea la fila durante la transacción → previene race condition
- Una sola operación atómica reemplaza SELECT + UPDATE separados
- Respeta el patrón RPC existente del proyecto (`increment_agent_key_spend`)
- `SECURITY DEFINER` necesario para que funcione con RLS

---

### NG-009 — MCP Missing SSRF Validation

**Archivo:** `src/app/api/v1/mcp/route.ts`
**Líneas:** 119-125

**Problema actual:**
Cuando el MCP hace fetch a endpoints de agentes externos, no valida la URL con `validateEndpointUrl()`.

**Solución recomendada:**

Agregar el SSRF gate antes del fetch upstream, reutilizando la utilidad existente:

```typescript
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl';

// Antes de hacer fetch al endpoint del agente:
try {
  await validateEndpointUrl(agent.endpoint_url);
} catch (err) {
  return mcpError(-32600, `Agent endpoint validation failed: ${err instanceof Error ? err.message : 'Invalid URL'}`);
}
```

**Contexto:** El endpoint de register YA valida con `validateEndpointUrl()` al momento del registro. Sin embargo, un agente puede cambiar su endpoint después del registro (si hay update endpoint), o el DNS puede cambiar. La validación en tiempo de invocación es la defensa en profundidad.

**Rendimiento:** Mínimo impacto. La validación es un HEAD probe que agrega ~50-200ms, pero solo ocurre en `tools/call` (no en `tools/list` que es solo catálogo).

---

### NG-010 — Middleware Excluye Todas las API Routes

**Archivo:** `middleware.ts`
**Líneas:** 57-60

**Problema actual:**
```typescript
export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
```
Todas las rutas `/api/` están excluidas del middleware. Esto significa que los security headers (CSP, nonce) y la validación de auth del middleware no aplican a API routes.

**Contexto del stack:**
- Cada API route maneja su propia auth (Supabase JWT, API key, CRON_SECRET)
- El middleware principalmente maneja: auth redirect, CSP nonce, locale routing
- Las API routes no necesitan CSP nonce ni locale routing

**Solución recomendada:**

No es viable pasar todas las API routes por el middleware actual (rompería el flujo). La solución correcta es crear un middleware ligero para APIs que aplique headers de seguridad mínimos:

```typescript
// En middleware.ts — agregar un path separado para APIs:
export const config = {
  matcher: [
    '/((?!_next|.*\\..*).*)' // Incluir TODAS las rutas excepto _next y archivos estáticos
  ],
};

// Dentro del middleware function, separar flujos:
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- API Routes: solo security headers ---
  if (pathname.startsWith('/api/')) {
    const response = NextResponse.next();

    // Headers de seguridad para APIs
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('X-DNS-Prefetch-Control', 'off');

    // Eliminar headers que revelan info interna
    response.headers.delete('X-Powered-By');

    return response;
  }

  // --- Page Routes: flujo existente (auth, CSP, locale) ---
  // ... código existente sin cambios ...
}
```

**Por qué esta solución:**
- No rompe el flujo existente de page routes
- No agrega auth redundante a APIs (ya tienen la suya)
- Sí agrega headers de seguridad defensivos (nosniff, no-frame, referrer policy)
- Elimina `X-Powered-By` que revela el framework

---

### NG-011 — Rate Limiter Key Leak en Headers

**Solución:** En la respuesta del rate limiter, eliminar los headers internos de Upstash antes de retornarlos al cliente:

```typescript
// Después de la respuesta del rate limiter, antes de retornar:
response.headers.delete('x-ratelimit-limit');
response.headers.delete('x-ratelimit-remaining');
response.headers.delete('x-ratelimit-reset');
```

Solo mantener el header estándar `Retry-After` cuando el rate limit se excede (429).

---

### NG-012 — CSRF Missing Origin Fallback

**Solución:** Agregar fallback a `Referer` header en la validación CSRF:

```typescript
function getRequestOrigin(request: Request): string | null {
  // Prioridad: Origin > Referer
  const origin = request.headers.get('origin');
  if (origin) return origin;

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch { /* invalid referer */ }
  }

  return null;
}
```

---

### NG-013 — Service Client en Server Component

**Solución:** Reemplazar `createServiceClient()` por `createServerClient()` con cookies del request:

```typescript
// ANTES (bypass RLS):
import { createServiceClient } from '@/lib/supabase/service';
const supabase = createServiceClient();

// DESPUÉS (respeta RLS):
import { createClient } from '@/lib/supabase/server';
const supabase = await createClient();
```

**Regla para project-context.md:**
```
## Supabase Client Rule
- Server Components: createClient() (respeta RLS del usuario)
- API Routes con lógica de negocio: createClient() (respeta RLS)
- API Routes que necesitan bypass RLS (cron, internal): createServiceClient()
- Client Components: createBrowserClient() (respeta RLS)
NUNCA usar createServiceClient() en Server Components.
```

---

### NG-014 — PostgREST .or() Interpolation

**No requiere acción.** Zod valida upstream. Monitorear en auditorías futuras.

---

## PARTE 2 — SOLUCIONES ON-CHAIN (NexusAudit)

---

### NA-201 — Operator Comprometido Drena dailySettlementCap

**Archivo:** `contracts/src/WasiAIMarketplace.sol`
**Líneas:** 422-476

**Problema:**
Un operador comprometido puede drenar hasta 10,000 USDC por ventana de 24h vía settlements fraudulentos.

**Solución recomendada — Monitoring + Cap dinámico:**

El multi-sig para operador es costoso en gas y complejidad. La solución pragmática es:

1. **Reducir dailySettlementCap** al volumen real promedio + 20% margen:
```solidity
// Si el volumen diario promedio es 500 USDC:
// Cap recomendado: 600 USDC (no 10,000)
function setDailySettlementCap(uint256 _cap) external onlyOwner {
    require(_cap > 0, "WasiAI: cap cannot be zero");
    require(_cap <= 50_000 * 1e6, "WasiAI: cap too high"); // hard limit 50k USDC
    dailySettlementCap = _cap;
    emit DailyCapUpdated(_cap);
}
```

2. **Agregar evento de alerta** cuando el settlement alcanza >80% del cap:
```solidity
event SettlementCapWarning(uint256 currentUsage, uint256 cap, uint256 percentUsed);

// Dentro de settleKeyBatch, después de actualizar dailySettled:
if (dailySettled[currentWindow] * 100 / dailySettlementCap > 80) {
    emit SettlementCapWarning(
        dailySettled[currentWindow],
        dailySettlementCap,
        dailySettled[currentWindow] * 100 / dailySettlementCap
    );
}
```

3. **Off-chain:** Listener de eventos que alerta en Telegram/Discord cuando `SettlementCapWarning` se emite.

**Clasificación:** KNOWN-LIMITATION con mitigación de monitoring. El cap sigue siendo la defensa principal.

---

### NA-202 — setTreasury Sin Timelock

**Archivo:** `contracts/src/WasiAIMarketplace.sol`
**Líneas:** 607-612

**Problema actual:**
```solidity
function setTreasury(address _treasury) external onlyOwner {
    require(_treasury != address(0), "WasiAI: zero address");
    treasury = _treasury;
    emit TreasuryUpdated(_treasury);
}
```
Cambio instantáneo sin timelock. Inconsistente con `proposeFee/executeFee` que sí tiene timelock.

**Solución recomendada — Mismo patrón de timelock:**

```solidity
// Variables de estado nuevas:
address public pendingTreasury;
uint256 public treasuryChangeTimestamp;

uint256 public constant TREASURY_TIMELOCK = 48 hours;

event TreasuryProposed(address indexed proposed, uint256 executeAfter);
event TreasuryExecuted(address indexed oldTreasury, address indexed newTreasury);

function proposeTreasury(address _treasury) external onlyOwner {
    require(_treasury != address(0), "WasiAI: zero address");
    require(_treasury != treasury, "WasiAI: same treasury");
    pendingTreasury = _treasury;
    treasuryChangeTimestamp = block.timestamp + TREASURY_TIMELOCK;
    emit TreasuryProposed(_treasury, treasuryChangeTimestamp);
}

function executeTreasury() external onlyOwner {
    require(pendingTreasury != address(0), "WasiAI: no pending treasury");
    require(block.timestamp >= treasuryChangeTimestamp, "WasiAI: timelock active");
    address oldTreasury = treasury;
    treasury = pendingTreasury;
    pendingTreasury = address(0);
    treasuryChangeTimestamp = 0;
    emit TreasuryExecuted(oldTreasury, treasury);
}

function cancelTreasuryChange() external onlyOwner {
    pendingTreasury = address(0);
    treasuryChangeTimestamp = 0;
}
```

**Tests Foundry necesarios:**
```solidity
function test_proposeTreasury_setsTimelock() public { ... }
function test_executeTreasury_revertsBeforeTimelock() public { ... }
function test_executeTreasury_worksAfterTimelock() public { ... }
function test_cancelTreasuryChange_clearsPending() public { ... }
function test_setTreasury_oldFunction_removed() public { ... }
```

**Importante:** Eliminar la función `setTreasury` actual. Si el frontend/backend la usa, actualizar el ABI (lección de NA-001 del audit anterior).

---

### NA-203 — recordInvocation Balance Check No-Atómico

**Archivo:** `contracts/src/WasiAIMarketplace.sol`
**Líneas:** 308-310

**Problema:**
Aunque en EVM una transacción es atómica, el backend puede enviar múltiples transacciones con el mismo agentKey antes de que se mine la primera.

**Solución recomendada — Nonce per-key:**

```solidity
mapping(bytes32 => uint256) public keyNonces; // agentKey => next expected nonce

function recordInvocation(
    bytes32 agentKey,
    uint256 agentId,
    bytes32 paymentId,
    uint256 expectedNonce  // nuevo parámetro
) external onlyOperator {
    // Nonce check — previene double-submit del backend
    require(expectedNonce == keyNonces[agentKey], "WasiAI: invalid nonce");
    keyNonces[agentKey]++;

    // ... resto de la lógica existente (idempotency check, balance check, etc.)
}
```

**Backend (invoke endpoint):**
```typescript
// Antes de enviar la TX on-chain:
const nonce = await publicClient.readContract({
  address: MARKETPLACE_ADDRESS,
  abi: marketplaceAbi,
  functionName: 'keyNonces',
  args: [agentKeyBytes32],
});

// Incluir nonce en la TX
await walletClient.writeContract({
  functionName: 'recordInvocation',
  args: [agentKey, agentId, paymentId, nonce],
});
```

**Alternativa más simple (sin cambio de contrato):**
Si no se quiere modificar el contrato, el backend puede usar un mutex en Redis (Upstash) per-agentKey:

```typescript
const lockKey = `invocation:lock:${agentKey}`;
const lock = await redis.set(lockKey, '1', { nx: true, ex: 10 }); // 10s TTL
if (!lock) {
  // Otra invocación en progreso para este key — esperar o rechazar
  return NextResponse.json({ error: 'Concurrent invocation in progress' }, { status: 429 });
}
try {
  // ... enviar TX on-chain ...
} finally {
  await redis.del(lockKey);
}
```

**Recomendación:** La solución Redis es más rápida de implementar y no requiere re-deploy del contrato. El nonce on-chain es más robusto pero requiere migración.

---

### NA-204 — Escrow releaseExpired vs refundExpired Race Condition

**Archivo:** `contracts/src/WasiEscrow.sol`
**Líneas:** 146-179

**Problema:**
Después de 24h, cualquiera puede llamar `releaseExpired()` o `refundExpired()`. El primer llamador decide el destino de los fondos sin verificar el resultado real de la tarea.

**Solución recomendada — Solo operador puede resolver + timeout extendido:**

```solidity
uint256 public constant RELEASE_TIMEOUT = 72 hours; // extender de 24h a 72h

function releaseExpired(bytes32 escrowId) external {
    Escrow storage e = escrows[escrowId];
    require(e.status == EscrowStatus.Pending, "WasiEscrow: not pending");
    require(block.timestamp > e.createdAt + RELEASE_TIMEOUT, "WasiEscrow: not expired");

    // Solo operador o marketplace pueden release (NO cualquier address)
    require(
        msg.sender == marketplace || operators[msg.sender],
        "WasiEscrow: not authorized"
    );

    _release(escrowId, e);
}

function refundExpired(bytes32 escrowId) external {
    Escrow storage e = escrows[escrowId];
    require(e.status == EscrowStatus.Pending, "WasiEscrow: not pending");
    require(block.timestamp > e.createdAt + RELEASE_TIMEOUT, "WasiEscrow: not expired");

    // Solo el payer original o el operador pueden refund
    require(
        msg.sender == e.payer || msg.sender == marketplace || operators[msg.sender],
        "WasiEscrow: not authorized"
    );

    e.status = EscrowStatus.Refunded;
    usdc.safeTransfer(e.payer, e.amount);
    emit EscrowRefunded(escrowId, e.payer, e.amount);
}

// Escape hatch: si NADIE actúa en 30 días, CUALQUIERA puede refund al payer
function emergencyRefund(bytes32 escrowId) external {
    Escrow storage e = escrows[escrowId];
    require(e.status == EscrowStatus.Pending, "WasiEscrow: not pending");
    require(block.timestamp > e.createdAt + 30 days, "WasiEscrow: emergency not active");

    e.status = EscrowStatus.Refunded;
    usdc.safeTransfer(e.payer, e.amount);
    emit EscrowRefunded(escrowId, e.payer, e.amount);
}
```

**Diseño:**
- **72h timeout:** Da tiempo suficiente al operador para procesar resultados de agentes de larga duración
- **release solo operador:** El operador verifica off-chain que la tarea se completó exitosamente
- **refund: payer o operador:** El payer puede recuperar sus fondos si la tarea falló
- **30 días emergency:** Mantiene la propiedad de escape trustless del diseño original

---

### NA-205 — depositForKey Permite Payer Diferente

**Solución simple:**

```solidity
function depositForKey(bytes32 agentKey, uint256 amount) external {
    // Si ya tiene owner, solo el owner puede depositar
    if (keyOwners[agentKey] != address(0)) {
        require(msg.sender == keyOwners[agentKey], "WasiAI: not key owner");
    }
    // ... resto de la lógica
}
```

**Alternativa:** Si quieres mantener la funcionalidad de "cualquiera puede depositar" (regalo/sponsorship), documentarlo como feature intencional y agregar evento:

```solidity
event ThirdPartyDeposit(bytes32 indexed agentKey, address indexed depositor, address indexed keyOwner, uint256 amount);
```

---

### NA-206 — settleKeyBatch No Valida Amounts

**Solución:**

```solidity
// Dentro del loop de settleKeyBatch:
for (uint256 i = 0; i < keys.length; i++) {
    Agent storage agent = agents[agentIds[i]];
    require(
        amounts[i] == agent.pricePerCall,
        "WasiAI: amount mismatch with pricePerCall"
    );
    // ... resto de la lógica
}
```

**Consideración:** Si hay descuentos o pricing dinámico planificado, agregar un flag `flexiblePricing` en vez de validación estricta.

---

### NA-207 — creatorFeeBps Dead Storage

**Solución:**

```solidity
// Eliminar del struct Agent:
// uint16 creatorFeeBps;  ← ELIMINAR

// Si está en el constructor o registerAgent, eliminar el parámetro también
// Limpiar cualquier referencia residual en tests
```

Verificar con `grep -r "creatorFeeBps" contracts/` que no quede ninguna referencia.

---

### NA-208 — disputeEscrow Sin Resolución

**Archivo:** `contracts/src/WasiEscrow.sol`

**Solución recomendada:**

```solidity
// Agregar función de resolución:
function resolveDispute(
    bytes32 escrowId,
    bool releaseToMarketplace  // true = release, false = refund
) external onlyOwner {
    Escrow storage e = escrows[escrowId];
    require(e.status == EscrowStatus.Disputed, "WasiEscrow: not disputed");

    if (releaseToMarketplace) {
        _release(escrowId, e);
        emit DisputeResolved(escrowId, "released");
    } else {
        e.status = EscrowStatus.Refunded;
        usdc.safeTransfer(e.payer, e.amount);
        emit DisputeResolved(escrowId, "refunded");
    }
}

event DisputeResolved(bytes32 indexed escrowId, string resolution);
```

**Diseño:** Solo el owner (no operador) puede resolver disputas. Esto mantiene separación de roles — el operador puede crear disputas pero no resolverlas.

---

### NA-209 — encodePacked Collision

**Solución:**
```solidity
// Reemplazar:
bytes32 key = keccak256(abi.encodePacked(param1, param2));
// Por:
bytes32 key = keccak256(abi.encode(param1, param2));
```
`abi.encode` pad cada parámetro a 32 bytes, eliminando colisiones.

---

### NA-210 — recordInvocation No Respeta Paused

**Solución:**
```solidity
function recordInvocation(
    bytes32 agentKey,
    uint256 agentId,
    bytes32 paymentId
) external onlyOperator whenNotPaused { // ← agregar whenNotPaused
    // ...
}
```

---

### NA-211 — Granularidad de Roles

**Solución recomendada para futuro upgrade:**

```solidity
import "@openzeppelin/contracts/access/AccessControl.sol";

bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

// settleKeyBatch → onlyRole(SETTLER_ROLE)
// registerAgent → onlyRole(REGISTRAR_ROLE)
// pause/unpause → onlyRole(PAUSER_ROLE)
```

**Nota:** Este cambio es breaking para el contrato actual. Solo implementar en un upgrade mayor con migración de estado.

---

### NA-212 — dailySettlementCap Puede Ser 0

**Solución:**
```solidity
function setDailySettlementCap(uint256 _cap) external onlyOwner {
    require(_cap >= 100 * 1e6, "WasiAI: cap too low"); // mínimo 100 USDC
    require(_cap <= 100_000 * 1e6, "WasiAI: cap too high"); // máximo 100k USDC
    dailySettlementCap = _cap;
    emit DailyCapUpdated(_cap);
}
```

---

## Patrones Transversales Identificados

### Patrón 1: Fail-Closed por Defecto
Todos los security checks deben fallar cerrado. Si una variable de entorno no existe, NEGAR acceso.
```
if (!env_var) → deny (500)
if (env_var && check_fails) → deny (401/403)
if (env_var && check_passes) → allow
```

### Patrón 2: Allowlist > Blocklist
Para origins, hosts, y URLs: validar contra allowlist (dominios conocidos) en vez de blocklist (IPs privadas).

### Patrón 3: Atomic Operations para Money
Todo check de balance + deducción debe ser atómico:
- On-chain: EVM garantiza atomicidad por transacción, pero prevenir multi-TX con nonces
- Off-chain: `FOR UPDATE` en PostgreSQL o mutex en Redis

### Patrón 4: Timelock para Cambios Críticos
Si `proposeFee` tiene timelock, `setTreasury`, `setDailySettlementCap`, y `addOperator` también deberían.

### Patrón 5: Reutilizar Security Utils
No duplicar lógica de seguridad. Centralizar en `src/lib/security/`:
- `allowed-origins.ts` — validación de origins (NG-001, NG-004)
- `validateEndpointUrl.ts` — SSRF gate (ya existe)
- `cron-auth.ts` — validación de CRON_SECRET (NG-003, reutilizable)

---

*Guía técnica generada por Auditor NexusAudit v2.0 + NexusGuard v1.0*
*Stack target: Next.js 16 + Supabase + Viem v2 + Foundry + OpenZeppelin*
