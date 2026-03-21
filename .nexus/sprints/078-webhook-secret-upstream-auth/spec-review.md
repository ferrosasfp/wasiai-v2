# Spec Review — SDD #078: Webhook Secret & Upstream Auth

**Reviewer:** Spec Reviewer (San, orquestador — Spec Reviewer timed out, ejecutado manualmente)
**Fecha:** 2026-03-19

---

## Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ PASS | `webhook_secret` no existe en ningún archivo de src/ ni en migraciones |
| 0.2 Archivos existen | ⚠️ PARCIAL | 9/11 archivos existen. Los 2 nuevos en `creator/agents/[slug]/webhook-secret/` no existen — correcto, son nuevos |
| 0.3a Tipos reales | ❌ 3 BLOQUEANTES | Ver findings F-01, F-02, F-03 |
| 0.3b pgcrypto disponible | ⚠️ RIESGO | `gen_random_bytes` no aparece en ninguna migración existente. No se puede confirmar que esté habilitado |
| 0.4 Dependencias | ✅ PASS | Sin dependencias de otros SDDs |
| 0.5 Completitud | ✅ PASS | SDD completo, sin TODOs bloqueantes |

---

## Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ✅ PASS | Todos los ACs tienen wave asignada |
| Build gates | ✅ PASS | Cada wave tiene build gate explícito |
| Rollback | ✅ PASS | Comandos SQL concretos + git revert |
| Constraints | ✅ PASS | 7 PROHIBIDO específicos |

---

## Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| F-01 | **BLOQUEANTE** | `callUpstreamMcp()` (línea 40) recibe solo `(endpointUrl: string, input: string, options?)`. El SDD dice "cambiar la firma para pasar `webhookSecret` y `agentId`" pero en el tools/call (línea 208) ya se hace `.select('*')` del model — disponible como variable local. La función se llama en línea 239: `callUpstreamMcp(model.endpoint_url, input, options)`. El Builder necesita instrucción exacta: ¿cambiar la firma de `callUpstreamMcp` agregando 2 parámetros, o pasar `model` completo, o inline el fetch? | Especificar en SDD: "Agregar parámetros `webhookSecret: string \| null` y `agentId: string` a `callUpstreamMcp`. El call site en línea 239 pasa `model.webhook_secret` y `model.id` — el `model` ya está disponible como variable local (select '*' en línea 208)" |
| F-02 | **BLOQUEANTE** | `compose/route.ts` selecciona los agentes con columnas explícitas (línea 244): `'id, slug, name, price_per_call, endpoint_url, status, category, max_rpm, max_rpd, input_schema, output_schema'` — **`webhook_secret` NO está en el select**. El Builder necesita saber que debe agregar `webhook_secret` a este select. Lo mismo aplica a: sandbox (línea 155), trial (línea 127), jobs (línea 72). Introspect usa `select('*')` (línea 244) — ✅ OK. Invoke usa `select('*')` (línea 163) — ✅ OK. | Agregar al SDD en Wave 1: para compose, sandbox, trial y jobs — "agregar `webhook_secret` al select explícito de agentes" como sub-tarea de cada wave |
| F-03 | **BLOQUEANTE** | `register/route.ts` importa `createHash` de `crypto` (línea 35) pero NO importa `randomBytes`. El servicio `generateApiKey()` usa `randomBytes` importado en `agent-keys.service.ts` — pero ese import no está en `register/route.ts`. El Builder necesita agregar `randomBytes` al import de crypto, o reusar `generateApiKey()` adaptado. | Especificar en SDD: "En `register/route.ts`, agregar `randomBytes` al import existente de `crypto`: `import { createHash, randomBytes } from 'crypto'`" |
| F-04 | **RIESGO MEDIO** | `gen_random_bytes` no aparece en ninguna migración existente de Supabase. No se puede confirmar que `pgcrypto` esté habilitado en el proyecto. Si no está, la migración falla en prod. | Agregar al SDD Wave 0: alternativa SQL segura sin pgcrypto: `encode(sha256(random()::text::bytea \|\| clock_timestamp()::text::bytea), 'hex')` — o verificar si Supabase habilita pgcrypto por defecto (sí lo hace en proyectos nuevos, pero confirmar en dev) |
| F-05 | MENOR | El SDD dice que `health/route.ts` no necesita auth (correcto) pero no hay instrucción explícita de "no tocar este archivo" en las waves. Un Builder desprevenido podría modificarlo. | Agregar `health/route.ts` como archivo explícitamente excluido en Constraint Directives |

---

## Veredicto

**NECESITA CORRECCIÓN**

**Bloqueantes antes de SPEC_APPROVED:**
- F-01: Especificar cómo cambiar `callUpstreamMcp` (firma exacta + call site)
- F-02: Agregar `webhook_secret` a los selects explícitos de compose, sandbox, trial, jobs
- F-03: Agregar `randomBytes` al import de crypto en `register/route.ts`

**No bloqueantes (el Builder puede resolver):**
- F-04: Riesgo de pgcrypto — agregar alternativa al SDD
- F-05: Mención explícita de health/route.ts como excluido
