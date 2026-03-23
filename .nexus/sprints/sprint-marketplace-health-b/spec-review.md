# Spec Review — Sprint Marketplace Health B
**Revisor:** Spec Reviewer (subagent)
**Fecha:** 2026-03-23
**Stack verificado:** Next.js 14 App Router + Supabase + TypeScript strict
**TSC baseline:** ✅ `npx tsc --noEmit` — sin errores antes de implementar

---

## Spec Review — SDD #281 (Cron health check periódico)

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix existe | ✅ PASS | `src/app/api/cron/health-check-agents/route.ts` no existe. `consecutive_failures` no existe en `agents`. Cambio nuevo. |
| 0.2 Archivos existen | ✅ PASS | `vercel.json` ✅, `reconcile-onchain/route.ts` ✅, `health-probe.ts` ✅ |
| 0.3a Tipos correctos | ⚠️ MENOR | `HealthCheckResult` es `interface` privada (no `export`) en `health-probe.ts` línea 11. El código de Wave 2 no la importa directamente — usa inferencia de TypeScript desde `probeEndpointSync` return type. No bloquea compilación. |
| 0.3b Encoding correcto | ✅ PASS | `probeEndpointSync` exportado en línea 123, firma `(endpointUrl: string) => Promise<{passed, status, healthCheck}>` — el código del cron usa `result.passed` y `result.healthCheck` correctamente. |
| 0.3d DB Security | ✅ PASS | Usa `createServiceClient()` (service_role, ya usada en otros crons). No crea funciones SQL. |
| 0.4 Dependencias | ✅ PASS | Depende de WAS-277 (`probeEndpointSync`). Confirmado presente en `health-probe.ts`. |
| 0.5 Completitud | ⚠️ MENOR | `maxDuration = 60` pero otros crons usan 120. Probe timeout es 5s/agente × 10 = 50s teórico, más overhead. Límite de 60s es ajustado. |

### Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ✅ PASS | AC1-AC7 cubiertos: Wave 1 (migration), Wave 2 (lógica), Wave 3 (schedule), Wave 4 (tipos) |
| Build gates | ✅ PASS | Todas las waves tienen `npx tsc --noEmit` |
| Rollback | ✅ PASS | `git revert HEAD` + instrucción de migration down |
| Constraints | ✅ PASS | 4 constraints específicos: runtime nodejs, maxDuration, batch limit, no cambio de status con failures=0 |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | MENOR | `maxDuration = 60` mientras otros crons usan 120. Con BATCH_SIZE=10 y probe timeout 5s + overhead SSRF/DNS, el límite de 60s es muy justo. | Cambiar a `maxDuration = 120` para alinearse con patrón del repo. |
| 2 | MENOR | `HealthCheckResult` no está exportado desde `health-probe.ts` (línea 11: `interface HealthCheckResult`). Si el Builder intenta anotar el tipo explícitamente fallará. | Exportar: `export interface HealthCheckResult` en `health-probe.ts`, o documentar que el Builder NO debe importarla y usar inferencia. |
| 3 | INFO | `probeEndpointSync` retorna `status: 'active' | 'reviewing'` que el cron ignora en favor de su propia lógica. No es un bug, pero el campo `status` del return es dead code en este contexto. | Sin acción requerida — la lógica del cron es correcta por diseño. |

### Veredicto
**✅ LISTO** — SDD correcto, listo para SPEC_APPROVED con las dos correcciones menores documentadas (maxDuration y export de HealthCheckResult). No bloqueantes.

---

## Spec Review — SDD #282 (Detección de spam/multi-alias)

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix existe | ✅ PASS | `account_status` y `email_domain` no existen en `creator_profiles`. Cambio nuevo. |
| 0.2 Archivos existen | ✅ PASS | `agent-signup/route.ts` ✅, `agents/register/route.ts` ✅, `creator/agents/[slug]/status/route.ts` ✅ |
| 0.3a Tipos correctos | ❌ FAIL | Ver Findings #1 y #2 — lógica incompleta en Wave 2. |
| 0.3b Encoding correcto | ❌ FAIL | Ver Finding #1 — columna `email_domain` en migration está incompleta. |
| 0.3d DB Security | ✅ PASS | ENUM y columna sin SECURITY DEFINER. INDEX parcial correcto. |
| 0.4 Dependencias | ✅ PASS | No depende de otros SDDs. |
| 0.5 Completitud | ❌ FAIL | Wave 2 tiene "NOTA para el Builder" con SQL crítico no incluido en Wave 1. Ver Finding #1. |

### Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ⚠️ PARCIAL | AC1/AC2 en Wave 2 ✅. AC3 en Wave 3 ✅. AC4/AC5 implícitos. Pero el SDD header lista `agent-signup/route.ts` como archivo a modificar y ninguna Wave lo toca — AC1 debería aplicarse en signup, no solo en registro de agente. |
| Build gates | ✅ PASS | Todas las waves tienen build gate. |
| Rollback | ✅ PASS | `git revert HEAD` + instrucciones DROP COLUMN/TYPE. |
| Constraints | ✅ PASS | 3 PROHIBIDO bien definidos + 1 OBLIGATORIO. |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | **BLOQUEANTE** | Wave 1 migration SQL no incluye `ALTER TABLE creator_profiles ADD COLUMN IF NOT EXISTS email_domain TEXT`. Esto está solo en una "NOTA para el Builder" dentro de Wave 2. La migration incompleta hará fallar el `CREATE INDEX creator_profiles_email_domain_idx` en Wave 2 y el query `.eq('email_domain', domain)` en runtime. | Mover el SQL de `email_domain` y su índice a la Wave 1 migration. El Builder no debería tener que buscar SQL crítico en notas de otra wave. |
| 2 | **BLOQUEANTE** | Lógica de `resolveAccountStatus` tiene off-by-one bug: consulta `creator_profiles.count WHERE email_domain = domain` sin excluir el usuario actual. En el flujo de `register/route.ts`, la función `resolveCreatorFromEmail` (línea ~127) hace `upsert` ANTES de que el agente se registre, por lo que en segundo registro del mismo usuario su propio perfil ya existe con `email_domain` set. Si hay 2 perfiles del mismo dominio + el usuario actual = 3 ≥ threshold → se flagea incorrectamente a usuarios legítimos en su segunda acción. | Agregar `.neq('id', userId)` al query de conteo en `resolveAccountStatus`, recibiendo `userId` como tercer parámetro. |
| 3 | MAYOR | El SDD coloca la detección en `register/route.ts` (registro de agentes), pero la creación de cuentas reales de usuarios ocurre en `agent-signup/route.ts`. Un creador malintencionado puede crear 3+ cuentas sin registrar ningún agente y evadir el check hasta que publique su primer agente. El check llega tarde en el flujo. | Mover o duplicar el check de `account_status` a `agent-signup/route.ts` en el momento de `upsert creator_profiles`. Esto alinea con AC1: "WHEN se crea una cuenta". |
| 4 | MENOR | El SDD lista `src/app/api/v1/auth/agent-signup/route.ts` en el header como archivo a modificar ("check en registro") pero ninguna Wave lo implementa. Inconsistencia entre header y waves. | Actualizar header del SDD para reflejar que la modificación va en `register/route.ts`, o crear Wave 4 para `agent-signup/route.ts`. |

### Veredicto
**❌ NECESITA CORRECCIÓN**

Bloqueantes antes de implementar:
1. **Wave 1 migration incompleta** — `email_domain TEXT` y su índice deben estar en el SQL de Wave 1, no como nota en Wave 2.
2. **Bug off-by-one en `resolveAccountStatus`** — el conteo de dominios debe excluir el ID del usuario actual (`.neq('id', userId)`).

---

## Spec Review — SDD #283 (Badge de salud en marketplace UI)

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix existe | ✅ PASS | `health_check` y `last_checked_at` existen en DB (actualizados por WAS-277) pero no expuestos en API ni en UI. Cambio nuevo. |
| 0.2 Archivos existen | ✅ PASS | `v1/agents/route.ts` ✅, `models.types.ts` ✅, `ModelCard.tsx` ✅, `OnChainBadge.tsx` ✅ (patrón para new badge), `messages/en.json` ✅ |
| 0.3a Tipos correctos | ⚠️ MENOR | `HealthCheckResult` no exportado desde `health-probe.ts`. Wave 2 usa tipo inline en `Model` — correcto, no necesita importar. ✅ |
| 0.3b Encoding correcto | ✅ PASS | `useTranslations` en componente client: confirmado patrón existente en `OnChainStats.tsx`, `WasiFooter.tsx` y otros. Provider configurado. |
| 0.3d DB Security | N/A | Sin cambios de DB. |
| 0.4 Dependencias | ⚠️ PARCIAL | Depende funcionalmente de WAS-281 para que el badge muestre datos útiles. WAS-281 no está DONE aún (mismo sprint). Orden de deploy: WAS-283 puede implementarse en paralelo pero el badge mostrará "not_checked" en producción hasta que WAS-281 corra su primer cron. Documentar en notas de deploy. |
| 0.5 Completitud | ⚠️ MENOR | Wave 1 menciona "También agregar al select del path de búsqueda slim (línea ~158) si existe un path slim" — el path slim SÍ existe (línea 158, search queries). La instrucción condicional crea ambigüedad. |

### Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ✅ PASS | AC1 → Wave 1, AC2-AC4 → Wave 3, AC5 → Wave 5, AC6 → Wave 3 (aria-label presente en código) |
| Build gates | ✅ PASS | Todas las waves tienen build gate. |
| Rollback | ✅ PASS | `git revert HEAD` sin migraciones — correcto. |
| Constraints | ✅ PASS | 3 PROHIBIDO + 2 OBLIGATORIO bien definidos. |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | MAYOR | El select del **path de búsqueda slim** (línea 158 de `route.ts`) NO incluye `health_check` ni `last_checked_at`. Wave 1 dice "si existe un path slim" condicionalmente — pero sí existe y se usa para search queries. Resultado: cuando un usuario busca agentes, los resultados del marketplace NO tendrán badge de salud aunque el browse normal sí lo tenga. Inconsistencia de UX. | Hacer explícito que el slim select también debe incluir `health_check, last_checked_at`. Eliminar la ambigüedad "si existe". |
| 2 | MENOR | El response mapper (línea ~325) no está incluido en el snippet de Wave 1 — solo el select. El SDD dice "En el response mapper (~línea 325), agregar:" y da el snippet. El Builder debe localizar el mapper manualmente. Aceptable pero el número de línea podría ser incorrecto con futuros cambios. | Sin cambio requerido — el snippet está dado. Verificar número de línea actual antes de implementar. |
| 3 | MENOR | `HealthBadge` tiene `'use client'` pero no usa ningún hook de estado ni efecto — es puramente presentacional. Podría ser Server Component, evitando hidratación en cliente. Sin embargo, `useTranslations` en app router puede requerir client en ciertos contextos. No es un bloqueante. | Considerar eliminar `'use client'` y usar `getTranslations` (server-side) para reducir JS bundle. Opcional. |
| 4 | INFO | Wave 5 (traducciones) viene DESPUÉS de Wave 3 (componente que usa las traducciones). Si el Builder aplica waves parcialmente y hace build después de Wave 3 pero antes de Wave 5, puede haber error en runtime por clave `health_badge` faltante. | El Builder debe aplicar Wave 5 antes de Wave 3, o aplicar todas en un solo commit. Agregar nota de orden de ejecución. |

### Veredicto
**⚠️ NEEDS_REVISION** (1 finding mayor, no bloqueante estrictamente pero genera bug UX)

La inconsistencia del slim select (Finding #1) causa que search results no muestren el badge. Requiere aclaración explícita en Wave 1 antes de implementar.

---

## Resumen Ejecutivo

| SDD | Veredicto | Bloqueantes |
|-----|-----------|-------------|
| WAS-281 Cron health check | ✅ LISTO | — |
| WAS-282 Spam detection | ❌ NECESITA CORRECCIÓN | 2 bloqueantes: migration incompleta + bug off-by-one |
| WAS-283 Health badge UI | ⚠️ NEEDS_REVISION | 0 bloqueantes, 1 mayor (slim select ambiguo) |

**Acción requerida antes de entregar a Builder:**
1. **WAS-282:** Mover SQL de `email_domain` a Wave 1 migration. Agregar `.neq('id', userId)` al query de conteo.
2. **WAS-283:** Hacer explícito en Wave 1 que el slim select (línea 158) también necesita `health_check, last_checked_at`.
