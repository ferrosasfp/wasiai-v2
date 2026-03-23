# Logic Audit — Sprint Marketplace Health B
**Auditor:** Logic Auditor (subagente NexusAgil)
**Fecha:** 2026-03-23
**Commits auditados:**
- `3cc3029b6` — WAS-281: cron health check periódico
- `3e340da89` — WAS-282: spam detection account_status + email_domain
- `7a2ee6617` — WAS-283: health badge en marketplace UI

---

## WAS-281 — Cron health check periódico (commit `3cc3029b6`)

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1: Verifica active+reviewing en batches de 10 | Sí | route.ts:31-40 (`.in('status',['active','reviewing'])`, `.limit(BATCH_SIZE)`) | ✅ OK |
| AC2: Probe pasa → reset failures, actualiza health_check/last_checked_at, reactiva si estaba reviewing con failures>0 | Sí | route.ts:54-66 | ✅ OK |
| AC3: Probe falla → incrementa consecutive_failures en 1 | Sí | route.ts:68-71 | ✅ OK |
| AC4: consecutive_failures >= 3 → status: reviewing | Sí | route.ts:72-74 (`shouldDegrade = newFailures >= FAILURE_THRESHOLD`) | ✅ OK |
| AC5: Sin endpoint_url → se salta sin error | Sí | route.ts:33 (`.not('endpoint_url','is',null)`) | ✅ OK |
| AC6: Sin CRON_SECRET → 401 | Sí | route.ts:23-25 | ✅ OK |
| AC7: Responde `{ checked, passed, failed, reactivated }` | Sí | route.ts:89 | ✅ OK |

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| 1 | **BLOQUEANTE** | Constraint violada | `maxDuration = 120` — el SDD especifica **OBLIGATORIO `maxDuration = 60`** (Vercel Pro limit para crons). El valor 120 puede causar que Vercel rechace el deploy o que el cron sea terminado antes de completar en planes que no sean Enterprise. | route.ts:15 |
| 2 | MENOR | Concurrencia | No hay protección contra ejecuciones paralelas del cron. Si dos invocaciones corren simultáneamente (Vercel retry, edge case), el mismo agente puede ser probado dos veces y `consecutive_failures` puede incrementarse dos veces o la reactivación puede ocurrir con stale data. Mitigación: el `.order('last_checked_at', ascending)` + batch pequeño reduce el riesgo pero no lo elimina. Sin mutex. | route.ts:31-40 |
| 3 | MENOR | Edge case | Agente con `status: 'reviewing'` y `consecutive_failures = 0` (puesto en reviewing manualmente) pasa el probe: la condición `wasReviewing && agent.consecutive_failures > 0` correctamente NO lo reactiva. ✅ Sin embargo, el log `logger.warn` en fallo intenta acceder a `result.healthCheck.reason` — si `result.healthCheck` es `undefined` o `null` esto lanza TypeError no capturado dentro del catch outer. Depende del contrato de `probeEndpointSync`. | route.ts:82 |

### Veredicto WAS-281
**REQUIERE CORRECCIÓN** — 1 bloqueante: `maxDuration` debe ser `60`, no `120`.

---

## WAS-282 — Spam detection account_status + email_domain (commit `3e340da89`)

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1: Dominio con ≥3 cuentas existentes → pending_review | Sí | register/route.ts:108-112 (`(domainCount ?? 0) >= 3`) | ✅ OK |
| AC2: Dominio masivo → exento, account_status = 'active' | Sí | register/route.ts:101-103 (`BULK_EMAIL_PROVIDERS.has(domain)`) | ✅ OK |
| AC3: pending_review → bloquear activación con 403 y mensaje claro | Sí | status/route.ts:80-94 | ✅ OK |
| AC4: Cuentas active → comportamiento sin cambio | Sí | El check solo actúa si `account_status === 'pending_review'` | ✅ OK |
| AC5: Cuentas existentes NO retroactivamente afectadas | Sí | Migration usa `DEFAULT 'active'`, sin UPDATE retroactivo | ✅ OK |

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| 4 | **BLOQUEANTE** | Lógica incorrecta — re-registro | `resolveCreatorFromEmail` usa `upsert({ onConflict: 'id' })`. Esto significa que si un usuario legítimo (cuya cuenta fue creada antes de que 2 nuevas cuentas del mismo dominio llegaran) registra un agente **después** de que el dominio tenga ≥3 cuentas, **su propio `account_status` se actualiza a `pending_review` en el upsert**. El SDD dice "solo aplica a nuevos registros". El upsert re-evalúa y sobreescribe el status en cada llamada. Un usuario legítimo puede quedar bloqueado por actividad posterior de otros en su dominio. | register/route.ts:154-156 |
| 5 | MENOR | Concurrencia | Race condition: dos registros simultáneos del mismo dominio (cuentas 3 y 4) pueden ambos leer `domainCount = 2` antes de que cualquiera se inserte, y ambos obtener `account_status = 'active'`. Threshold de ≥3 se bypassea. Riesgo bajo en práctica pero existe. | register/route.ts:107-113 |
| 6 | MENOR | Edge case | Email sin `@` (e.g., datos corruptos): `email.split('@')[1]` retorna `undefined`, el `?? ''` lo convierte a `''`. La condición `!domain` retorna `'active'` correctamente. ✅ Pero `email_domain` se persiste como `null` en la DB — correcto per el schema (`email_domain TEXT` nullable). ✅ |  register/route.ts:100 |

### Veredicto WAS-282
**REQUIERE CORRECCIÓN** — 1 bloqueante: la lógica del upsert en `resolveCreatorFromEmail` sobreescribe `account_status` en cada re-registro, violando el requisito de "solo aplica a nuevos registros". Fix: solo setear `account_status` en insert, no en update (separar el upsert o añadir condición `onConflict: { ignoreDuplicates: true }` para esos campos, o verificar si el perfil ya existe antes del upsert).

---

## WAS-283 — Health badge en marketplace UI (commit `7a2ee6617`)

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1: API /v1/agents incluye health_check y last_checked_at | Sí | route.ts:158 (slim) y route.ts:213-214 (full), mapper:334-335 | ✅ OK |
| AC2: passed=true → 🟢 Online | Sí | HealthBadge.tsx:34-43 | ✅ OK |
| AC3: passed=false → 🔴 Down con tooltip "Last checked X min ago" | Sí | HealthBadge.tsx:45-55 (`title={checkedLabel}`) | ✅ OK |
| AC4: last_checked_at === null → ⚪ Not checked | Sí | HealthBadge.tsx:17-27 (`!lastCheckedAt \|\| healthCheck === null`) | ✅ OK |
| AC5: i18n para locales distintos de 'en' | Sí | messages/en.json + messages/es.json ambos con `health_badge.*` | ✅ OK |
| AC6: aria-label en todos los estados del badge | Sí | HealthBadge.tsx:20, 37, 47 | ✅ OK |

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| 7 | MENOR | Edge case — estado ambiguo | Si `lastCheckedAt` tiene valor pero `healthCheck === null` (probe corrió pero no guardó resultado — posible bug upstream), el badge muestra ⚪ "Not checked" aunque el agente sí fue chequeado. El usuario ve información incorrecta. El AC4 solo describe `last_checked_at === null`, no el caso donde solo `healthCheck` es null. | HealthBadge.tsx:17 |
| 8 | MENOR | Edge case — tiempo negativo | `getMinutesAgo` puede retornar valor negativo si el reloj del servidor tiene drift futuro. `Math.floor` de negativo → número negativo → "Last checked -2min ago". Sin `Math.max(0, ...)`. | HealthBadge.tsx:13 |
| 9 | MENOR | Scope creep | El mapper en `route.ts:334-335` usa `?? null` redundantemente — `health_check` y `last_checked_at` ya son `null` por defecto desde el select si no existen. Cosmético, no bug. | route.ts:334-335 |

### Veredicto WAS-283
**APROBADO** — Sin bloqueantes. Findings 7 y 8 son edge cases menores que no afectan el comportamiento en el caso normal. Corregir en próximo sprint si se observan en producción.

---

## Resumen ejecutivo

| Issue | Commit | Veredicto | Bloqueante |
|-------|--------|-----------|-----------|
| WAS-281 — Cron health check | `3cc3029b6` | **REQUIERE CORRECCIÓN** | `maxDuration = 120` viola constraint del SDD (debe ser 60) |
| WAS-282 — Spam detection | `3e340da89` | **REQUIERE CORRECCIÓN** | Upsert sobreescribe `account_status` en re-registros, violando "solo aplica a nuevos registros" |
| WAS-283 — Health badge UI | `7a2ee6617` | **APROBADO** | — |

**Acción requerida:** El Builder debe corregir WAS-281 y WAS-282 antes de pasar a QA Verifier.

---

LOGIC AUDIT COMPLETE
