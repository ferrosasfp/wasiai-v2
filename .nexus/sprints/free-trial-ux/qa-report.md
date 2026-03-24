# QA Report — Free Trial UX (Sandbox + A2A + Zero Duplicación)

> QA Verifier: subagent qa-verifier  
> Fecha: 2026-03-23  
> Build: TSC OK / LINT OK

---

## AC Verification

| AC | Status | Evidencia (archivo:línea) |
|----|--------|--------------------------|
| **AC-1**: Eliminar Route C del invoke | ✅ PASS | `invoke/route.ts` — No existe bloque `if (!paymentHeader && model.free_trial_enabled)`. Flujo sin auth salta directo al sandbox check (línea ~235) y luego al 402 en `build402Instructions()`. Route C eliminada. |
| **AC-2**: Trial acepta body nativo (A2A) | ✅ PASS | `trial/route.ts:14-16` — `LegacyBody`, `NativeBody`, `BodySchema = z.union([LegacyBody, NativeBody])`. Body nativo pasa vía `upstreamBody = JSON.stringify(parsedData)` (línea ~175) cuando no es legacy. |
| **AC-3**: Sandbox Mode en Trial | ✅ PASS | `trial/route.ts:76` — `isSandbox = req.headers.get('x-sandbox') === 'true'`. Path sandbox en línea ~137: checa `isSandbox && agent.sandbox_enabled`, retorna sin upstream, sin decremento, con `{ sandbox: true }`. Log via `after()` con `payment_type: 'sandbox'`. |
| **AC-4**: Sandbox fallback sin example_output | ✅ PASS | `trial/route.ts:140` — `meta?.input_example ?? meta?.example_output ?? { message: 'Sandbox mode — no example output configured' }`. Retorna fallback mensaje cuando no hay example. |
| **AC-5**: Sandbox en Invoke | ✅ PASS | `invoke/route.ts` — bloque "2b. Sandbox shortcut" después del check de Agent Key. Checa `request.headers.get('x-sandbox') === 'true' && model.sandbox_enabled`. Retorna `{ result: exampleOutput, meta: { model: slug, sandbox: true, charged: 0 } }`. Usa `createServiceClient()` para el log (bug #2 del logic-audit ya fixeado). No llama upstream. |
| **AC-6**: Body schema actualizado | ✅ PASS | `trial/route.ts:14-16` — Zod union acepta `{ input: string }` (legacy) y cualquier objeto JSON (nativo). Cuando `isSandbox=true`, validación Zod se salta (`if (!isSandbox) { parsed = ... }`). |
| **AC-7**: No romper frontend | ✅ PASS | `trial/route.ts` — Invariante `{ output: string, latencyMs }` preservado. Sandbox retorna `{ output, sandbox: true, latencyMs: 0 }`. Path normal retorna `{ output, latencyMs }` (línea ~210). `output` siempre es string (se fuerza con `JSON.stringify` si no es string). |
| **AC-8**: 402 response incluye trial info | ✅ PASS | `invoke/route.ts` — función `build402Instructions()`: `const freeTrial = model.free_trial_enabled ? { available: true, endpoint: '/api/v1/agents/${slug}/trial', limit: model.free_trial_limit } : undefined`. Se incluye en respuesta 402 si `free_trial_enabled`. |

---

## Build Verification

| Check | Status |
|-------|--------|
| `npx tsc --noEmit` | ✅ TSC OK |
| `npx eslint ... --max-warnings 0` | ✅ LINT OK |

---

## Bugs del Logic Audit — Estado de Fixes

| Bug | Severidad | Fix aplicado | Evidencia |
|-----|-----------|-------------|-----------|
| **Bug #1**: Null dereference `parsed!.data` cuando `isSandbox && !sandbox_enabled` | 🔴 CRÍTICO | ✅ FIXEADO | `trial/route.ts` — bloque post-buscar-agente: `if (isSandbox && !agent.sandbox_enabled) { parsed = BodySchema.safeParse(...); if (!parsed.success) return 400 }`. La variable `parsed` se asigna antes de llegar a `parsed!.data`. |
| **Bug #2**: `after()` en invoke sandbox usaba `supabase` (user client) en vez de service client | 🟡 MENOR | ✅ FIXEADO | `invoke/route.ts` — sandbox shortcut usa `createServiceClient()` explícitamente dentro del `after()` callback. |
| **Bug #3**: Zod union ordena LegacyBody primero | 🟡 MENOR | ⚠️ NO FIXEADO (comportamiento documentado) | `trial/route.ts:16` — union mantiene `[LegacyBody, NativeBody]`. Impacto real bajo: el routing por `upstreamBody` check `'input' in parsedData && typeof parsedData.input === 'string'` garantiza comportamiento correcto. No bloquea. |

---

## Constraint Violations

| Constraint | Status |
|------------|--------|
| PROHIBIDO: Dos paths de free trial | ✅ OK — Route C eliminada |
| PROHIBIDO: Exponer `endpoint_url` | ✅ OK — no expuesto en ninguna respuesta nueva |
| PROHIBIDO: Sandbox sin rate limit | ✅ OK — rate limit se aplica antes del sandbox check en ambos endpoints |
| PROHIBIDO: Romper `AgentTrialPlayground` | ✅ OK — invariante `{ output: string, latencyMs }` preservado |
| OBLIGATORIO: Usar RPC `use_trial` | ✅ OK — usado en path autenticado; sandbox lo bypasea correctamente |
| OBLIGATORIO: Body nativo pasa directo | ✅ OK — `JSON.stringify(parsedData)` sin wrapping |
| OBLIGATORIO: `{ input: string }` legacy funciona | ✅ OK — LegacyBody en union |
| OBLIGATORIO: Sandbox NUNCA llama upstream | ✅ OK — ambos handlers retornan antes del fetch |
| OBLIGATORIO: Sandbox NUNCA decrementa counter | ✅ OK — `use_trial` RPC no se llama en sandbox path |

---

## Issues encontrados

**Ningún issue nuevo.** Los bugs críticos identificados en el Logic Audit (#1 y #2) fueron correctamente fixeados por el builder:

- Bug #1 (null dereference): resuelto con re-parse de body cuando `isSandbox && !sandbox_enabled`
- Bug #2 (user client en sandbox log): resuelto usando `createServiceClient()` en el `after()` de invoke

Bug #3 (orden del Zod union) permanece como comportamiento documentado, no bloquea y el impacto real es nulo dado el routing check adicional.

**Discrepancia SDD vs work-item (AC-2):** El work-item dice "parsea JSON si upstream responde JSON", el SDD dice "output siempre es STRING". El código sigue el SDD (correcto). La discrepancia es de documentación, no de implementación.

---

## Veredicto: ✅ PASS

Todos los ACs verificados con evidencia en código. Build limpio (TSC + ESLint). Bugs críticos del Logic Audit fixeados. Ready para merge.
