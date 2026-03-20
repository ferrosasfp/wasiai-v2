# Spec Review — Sprint 12
**Reviewer:** Spec Reviewer (NexusAgile v1.3)
**Fecha:** 2026-03-17
**SDDs:** WAS-225, WAS-190, WAS-232

---

## Spec Review — SDD WAS-225 — Transaction History

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ OK | `src/app/api/creator/transactions/route.ts` NO existe. `TransactionHistory.tsx` NO existe. Fix no pre-existe. |
| 0.2 Archivos referenciados | ✅ OK | `src/app/[locale]/creator/dashboard/page.tsx` EXISTE. `analytics/route.ts` EXISTE (patrón auth verificado). |
| 0.3a Código de referencia compila | ✅ OK | `createClient()` y `createServiceClient()` exportados de `@/lib/supabase/server`. Auth pattern en analytics/route.ts líneas 46-48 idéntico al descrito. |
| 0.3b Columnas DB — agent_calls | ✅ OK | `agent_slug` (migration 012 + 066), `amount_paid`, `status`, `called_at`, `settlement_batch_id` — todos confirmados en migraciones y uso en codebase. |
| 0.3b Columnas DB — key_batch_settlements | ⚠️ PARCIAL | Columnas listadas en SDD (id, key_id, tx_hash, total_usdc, call_count, status, confirmed_at) existen. **PERO** `key_id` es tipo `TEXT NOT NULL` en migration 012, NO UUID. El SDD lo lista como si fuera UUID. Causa TypeScript mismatch. |
| 0.3b Columnas DB — creator_withdrawal_vouchers | ❌ ERROR CRÍTICO | El SDD dice **"SIN tx_hash"** — pero migration 043 define `tx_hash TEXT` en la tabla. La columna SÍ EXISTE. El builder podría omitir tx_hash de withdrawals innecesariamente. |
| 0.3b Columnas DB — agents | ✅ OK | `id`, `slug`, `creator_id` — confirmados en analytics/route.ts y EarningsSection. |
| 0.4 Dependencias entre SDDs | ⚠️ ATENCIÓN | WAS-190 depende de `TransactionHistory.tsx` creado por WAS-225. El orden de implementación debe ser WAS-225 → WAS-190. Documentar explícitamente. |
| 0.5 SDD completo / ambigüedades | ⚠️ AMBIGÜEDAD | "filtro sin wallet" — no está especificado qué campos filtrar ni qué retornar cuando el creator no tiene wallet vinculada. |

### Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| Cada AC tiene wave | N/A | SDD no define waves explícitas — solo ACs. Si el Builder no recibe waves, puede omitir pasos. |
| Cada wave tiene build gate | N/A | Mismo — sin waves definidas. |
| Rollback ejecutable | ❌ AUSENTE | No hay instrucción de rollback (new route + new component — al menos documentar "eliminar archivos creados"). |
| ≥3 PROHIBIDO en constraints | ❌ AUSENTE | El SDD no lista ninguna sección PROHIBIDO/Constraints. |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| F1 | 🔴 CRÍTICO | `creator_withdrawal_vouchers` SÍ tiene columna `tx_hash TEXT` (migration 043). El SDD dice "SIN tx_hash". Si el builder confía en el SDD, omitirá el campo y perderá datos disponibles. | Corregir SDD: remover "SIN tx_hash". El builder debe incluir `tx_hash` en la query de withdrawals. |
| F2 | 🟡 MEDIO | `key_batch_settlements.key_id` es `TEXT NOT NULL` en DB (migration 012 línea 20), no UUID. Si el builder tipea como UUID habrá type mismatch en runtime. | Corregir SDD: especificar `key_id: string` (TEXT), no UUID. |
| F3 | 🟡 MEDIO | AC "filtro sin wallet" es ambiguo: ¿es un query param? ¿retorna 200 vacío o 403? | Definir: `?type=settlement\|withdrawal\|call` o documentar el comportamiento exacto del filtro. |
| F4 | 🟠 MENOR | No hay sección PROHIBIDO/Constraints ni rollback plan. | Añadir al menos: PROHIBIDO usar service role key en client-side; PROHIBIDO exponer tx_hash de otras creators; rollback: delete archivos creados. |
| F5 | 🟠 MENOR | SDD no especifica si la paginación usa cursor o offset. 20/página mencionado pero sin mecanismo. | Especificar: `?page=N` (offset) o `?cursor=<id>` (keyset). |

### Veredicto: ⛔ NECESITA CORRECCIÓN

**Bloqueantes:** F1 (dato erróneo sobre tx_hash), F2 (tipo de key_id). Resolver antes de pasar al Builder.

---

## Spec Review — SDD WAS-190 — Links Snowtrace

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ OK | `TransactionHistory.tsx` no existe aún — depende de WAS-225. No hay implementación previa. |
| 0.2 Archivos referenciados | ✅ OK | `src/lib/chain.ts` existe. `explorerTx` en línea 39 confirmado. |
| 0.3a Código de referencia compila | ✅ OK | `export const explorerTx = (hash: string) => \`${EXPLORER_URL}/tx/${hash}\`` — firma correcta, acepta string, retorna string. Import path `@/lib/chain` funcional. |
| 0.3b Columnas DB | ✅ OK | WAS-190 no interactúa con DB directamente — solo procesa datos del componente padre. |
| 0.4 Dependencias entre SDDs | ⚠️ DEPENDENCIA | WAS-190 modifica `TransactionHistory.tsx` que crea WAS-225. **WAS-225 DEBE ir antes.** Además, dado que WAS-225 tiene F1 (error tx_hash withdrawals), WAS-190 podría necesitar manejar tx_hash en withdrawal rows también. |
| 0.5 SDD completo | ⚠️ AMBIGÜEDAD | El SDD de WAS-225 dice withdrawals no tienen tx_hash, pero sí lo tienen (migration 043). WAS-190 debería cubrir también links en withdrawal rows. |

### Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| Cada AC tiene wave | N/A | Sin waves definidas. |
| Rollback ejecutable | ❌ AUSENTE | No documentado. |
| ≥3 PROHIBIDO | ❌ AUSENTE | Sin sección constraints. |
| AC: validar formato 0x[64 hex chars] | ✅ OK | Regex correcto: `/^0x[0-9a-fA-F]{64}$/` — tx hash es 32 bytes = 64 hex chars con prefijo 0x. |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| F1 | 🔴 CRÍTICO | WAS-190 asume que solo settlements tienen tx_hash (por el error de WAS-225). Pero `creator_withdrawal_vouchers.tx_hash` existe en DB. Si el builder no agrega link para withdrawals también, la funcionalidad será incompleta. | Actualizar WAS-190: también renderizar `explorerTx(row.tx_hash)` para tipo `withdrawal` cuando `tx_hash` no sea null. |
| F2 | 🟡 MEDIO | Dependencia hard en WAS-225 no documentada explícitamente. Si llegan en orden incorrecto, el Builder no tiene el archivo base para modificar. | Añadir en SDD: "DEPENDE DE WAS-225 (debe estar mergeado antes)". |
| F3 | 🟠 MENOR | `target="_blank"` sin `rel="noopener noreferrer"` es vulnerabilidad tabnapping. El SDD menciona target="_blank" pero no rel. | Especificar `rel="noopener noreferrer"` como requerimiento explícito. |

### Veredicto: ⚠️ NECESITA CORRECCIÓN

**Bloqueante:** F1 depende de corregir WAS-225 primero. F3 es security best practice obligatoria.

---

## Spec Review — SDD WAS-232 — Onboarding Wizard

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ OK | `src/app/api/v1/onboard/` NO existe. Tabla `onboarding_sessions` NO existe en migraciones. Fix no pre-existe. |
| 0.2 Archivos referenciados | ✅ OK | Todos los archivos a crear son nuevos. No hay archivos a modificar con dependencias. |
| 0.3a — probeEndpoint | ✅ OK | `src/lib/agents/health-probe.ts:20 export async function probeEndpoint(endpointUrl: string, agentId: string): Promise<void>` — existe y exportado. |
| 0.3a — generateApiKey | ✅ OK | `src/features/agent-api/services/agent-keys.service.ts:22 export function generateApiKey(): { raw: string; hash: string }` — existe. |
| 0.3a — validateEndpointUrlAsync | ✅ OK | `src/lib/security/validateEndpointUrl.ts:120 export async function validateEndpointUrlAsync(rawUrl: string): Promise<string>` — existe. |
| 0.3a — checkRateLimit, getAgentSignupLimit, getIdentifier | ✅ OK | Todos confirmados en `src/lib/ratelimit.ts` (líneas 80, 92, 137). |
| 0.3a — createServiceClient | ✅ OK | `src/lib/supabase/server.ts:42 export function createServiceClient()` — existe. |
| 0.3b Columnas DB — onboarding_sessions | ✅ OK | Tabla nueva. SQL de migración provisto es sintácticamente correcto. CHECK constraint en status correcto. TTL via `expires_at` con interval '30 minutes' correcto. |
| 0.4 Dependencias entre SDDs | ✅ OK | WAS-232 no depende de WAS-225 ni WAS-190. Puede implementarse en paralelo. |
| 0.5 SDD completo | ⚠️ AMBIGÜEDAD | Ver findings. |

### Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| Cada AC tiene wave | N/A | Sin waves definidas. |
| Rollback ejecutable | ❌ AUSENTE | Migración SQL nueva sin rollback (DROP TABLE). |
| ≥3 PROHIBIDO | ❌ AUSENTE | Sin constraints. |
| AC: email duplicado 409 | ⚠️ AMBIGUO | El wizard es por IP/session, no requiere email necesariamente en todos los steps. ¿En qué step se valida email? No especificado. |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| F1 | 🟡 MEDIO | `probeEndpoint(endpointUrl, agentId)` requiere `agentId` como segundo parámetro. En step3 del onboarding, el agente aún no existe en DB (se está registrando). ¿Qué `agentId` se pasa? | Aclarar en SDD: usar un agentId temporal/placeholder, o verificar si `probeEndpoint` puede recibir un fake ID en onboarding context. Revisar si la firma acepta undefined. |
| F2 | 🟡 MEDIO | La migración SQL no incluye índice en `expires_at` ni en `ip`. Las queries de rate limiting por IP y de limpieza de expired sessions serán full scans. | Añadir: `CREATE INDEX ON onboarding_sessions(ip)` y `CREATE INDEX ON onboarding_sessions(expires_at)`. |
| F3 | 🟡 MEDIO | AC "session expired → 404" y "session completed → 409": ambos dependen de leer `expires_at` y `status` de DB. No se especifica si la expiración se evalúa via `expires_at < now()` en el query o en código. Si se hace en código, hay race condition. | Especificar: usar `WHERE expires_at > now()` en el SELECT de sesión para atomicidad. |
| F4 | 🟠 MENOR | El rollback no está documentado. `onboarding_sessions` es una tabla nueva — si falla el deploy, necesita `DROP TABLE onboarding_sessions`. | Añadir rollback SQL al SDD. |
| F5 | 🟠 MENOR | El AC "email duplicado 409" asume que el wizard captura email en algún step, pero el schema de `onboarding_sessions.data` es JSONB libre. No hay constraints de unicidad en email. | Especificar en qué step se captura email y cómo se valida duplicado (query a `auth.users` o `creator_profiles`). |
| F6 | 🟠 MENOR | Rate limit: `getAgentSignupLimit()` retorna un Ratelimit object. `checkRateLimit` es la función que lo usa. El SDD debe especificar cuál de los límites existentes aplica, o si se crea uno nuevo para onboarding. | Aclarar: ¿usar `getAgentSignupLimit()` existente o definir nuevo `getOnboardingLimit()`? |

### Veredicto: ⚠️ NECESITA CORRECCIÓN

**Bloqueante:** F1 — `probeEndpoint` requiere agentId que no existe en step3. Necesita aclaración antes de implementar.

---

## Resumen Ejecutivo

| SDD | Veredicto | Bloqueantes |
|-----|-----------|-------------|
| WAS-225 | ⛔ NECESITA CORRECCIÓN | F1: tx_hash en vouchers existe (SDD incorrecto); F2: key_id es TEXT no UUID |
| WAS-190 | ⚠️ NECESITA CORRECCIÓN | F1: vouchers con tx_hash deben tener link también; depende de fix WAS-225 primero |
| WAS-232 | ⚠️ NECESITA CORRECCIÓN | F1: agentId requerido por probeEndpoint en step3 sin agente creado aún |

**Orden de corrección recomendado:** WAS-225 → WAS-190 → WAS-232
