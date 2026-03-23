# QA Report — Sprint Marketplace Health B

**Generado:** 2026-03-23  
**Commits verificados:**
- `3cc3029b6` — WAS-281 (cron health check)
- `3e340da89` — WAS-282 (spam detection)
- `7a2ee6617` — WAS-283 (health badge UI)

---

## WAS-281 — Cron de health check periódico

### Drift Detection

| Dimensión | Esperado (SDD) | Real (commit) | Status |
|-----------|---------------|---------------|--------|
| Archivos creados | `route.ts`, migration | `route.ts`, `076_add_consecutive_failures.sql` | ✅ OK |
| Archivos modificados | `vercel.json`, `models.types.ts` | `vercel.json`, `models.types.ts`, `PublishPreview.tsx` | ⚠️ DRIFT (PublishPreview.tsx fuera de scope) |
| Dependencias nuevas | ninguna | ninguna | ✅ OK |
| Número de migration | next disponible (≥076) | `076_` — colisión con WAS-282 | ⚠️ DRIFT (dos archivos con prefijo `076_`) |

**Nota de colisión de migrations:** `076_add_consecutive_failures.sql` (WAS-281) y `076_add_account_status.sql` (WAS-282) comparten el mismo número de migration `076`. En Supabase, el orden de aplicación en producción depende del nombre completo del archivo y puede causar conflictos al hacer `supabase db push`. Requiere corrección manual antes del deploy.

### AC Verification

| AC | Status | Evidencia | Test |
|----|--------|-----------|------|
| AC1: Verifica agentes `active` + `reviewing` en batches de 10 | ✅ CUMPLE | `route.ts:37-42` — `.in('status', ['active', 'reviewing'])` + `.limit(BATCH_SIZE)` con `BATCH_SIZE=10` | — |
| AC2: Probe exitoso → reset `consecutive_failures=0`, actualiza `health_check` + `last_checked_at`, reactiva si `reviewing` | ✅ CUMPLE | `route.ts:54-66` — update condicional `...(wasReviewing && agent.consecutive_failures > 0 ? { status: 'active' } : {})` | — |
| AC3: Probe fallido → incrementa `consecutive_failures` en 1 | ✅ CUMPLE | `route.ts:70-71` — `const newFailures = (agent.consecutive_failures ?? 0) + 1` | — |
| AC4: `consecutive_failures >= 3` → `status: 'reviewing'` | ✅ CUMPLE | `route.ts:72-73` — `const shouldDegrade = newFailures >= FAILURE_THRESHOLD` con `FAILURE_THRESHOLD=3` | — |
| AC5: Sin `endpoint_url` → salta sin error | ✅ CUMPLE | `route.ts:38-40` — `.not('endpoint_url', 'is', null)` filtra en la query, solo procesa agentes con endpoint | — |
| AC6: Sin `CRON_SECRET` → 401 | ✅ CUMPLE | `route.ts:24-26` — `if (authHeader !== \`Bearer ${process.env.CRON_SECRET}\`)` → 401 | — |
| AC7: Responde JSON `{ checked, passed, failed, reactivated }` | ✅ CUMPLE | `route.ts:91` — `return NextResponse.json({ checked, passed, failed, reactivated })` | — |

### Build & Tests

| Check | Result | Detail |
|-------|--------|--------|
| Build (`tsc --noEmit`) | ✅ PASS | Sin errores de TypeScript |
| Tests nuevos | ⚠️ Sin tests | No se crearon tests automatizados (ningún archivo `*.test.ts`) |
| Schedule en vercel.json | ✅ PASS | `"path": "/api/cron/health-check-agents", "schedule": "0 * * * *"` presente |
| Migration SQL | ✅ PASS | Columna + índice correctos en `076_add_consecutive_failures.sql` |

### Issues

1. ⚠️ **Colisión de migration numbers** — `076_add_consecutive_failures.sql` y `076_add_account_status.sql` comparten prefijo `076`. Riesgo de error en `supabase db push`. Requiere renombrar uno de los dos.
2. ⚠️ **`PublishPreview.tsx` modificado fuera de scope** — el SDD no menciona este archivo. Verificar que el cambio es necesario o regresar al estado anterior.
3. ℹ️ **`maxDuration = 120`** — el SDD dice `maxDuration = 60` (Vercel Pro limit para crons), pero el código tiene `120`. Puede causar error en deploy si el plan no lo soporta.

---

## WAS-282 — Detección de cuentas multi-alias (spam/bot)

### Drift Detection

| Dimensión | Esperado (SDD) | Real (commit) | Status |
|-----------|---------------|---------------|--------|
| Archivos creados | `076_add_account_status.sql` | `076_add_account_status.sql` | ✅ OK |
| Archivos modificados | `register/route.ts`, `status/route.ts` | `register/route.ts`, `status/route.ts` | ✅ OK |
| Archivos fuera de scope | 0 | 0 | ✅ OK |
| `agent-signup/route.ts` | mencionado en SDD header | no modificado | ⚠️ DRIFT — SDD lo lista como archivo a modificar pero no se tocó |

**Nota:** El SDD menciona `src/app/api/v1/auth/agent-signup/route.ts` en la sección de archivos pero la lógica de detección se implementó correctamente en `register/route.ts` (que es donde se crea el `creator_profile`). El `agent-signup/route.ts` parece ser un archivo diferente. Se asume implementación correcta en el archivo apropiado.

### AC Verification

| AC | Status | Evidencia | Test |
|----|--------|-----------|------|
| AC1: Dominio con ≥3 cuentas existentes → `account_status = pending_review` | ✅ CUMPLE | `register/route.ts:77-88` — `resolveAccountStatus()` cuenta con `.eq('email_domain', domain)` y retorna `'pending_review'` si `domainCount >= 3` | — |
| AC2: Dominio masivo conocido → exento, `account_status = 'active'` | ✅ CUMPLE | `register/route.ts:60-71` — `BULK_EMAIL_PROVIDERS` set con 16 dominios, `if (BULK_EMAIL_PROVIDERS.has(domain)) return 'active'` | — |
| AC3: Creador con `pending_review` intenta activar → 403 con mensaje claro | ✅ CUMPLE | `status/route.ts:80-94` — check `profile?.account_status === 'pending_review'` → 403 con `code: 'account_pending_review'` | — |
| AC4: Creador `active` opera sin cambio de comportamiento | ✅ CUMPLE | `status/route.ts:80-94` — el bloqueo solo se aplica si `=== 'pending_review'`, `active` no entra en el if | — |
| AC5: Cuentas existentes NO se afectan retroactivamente | ✅ CUMPLE | `076_add_account_status.sql` — `DEFAULT 'active'` en la migration; no hay UPDATE retroactivo | — |

### Build & Tests

| Check | Result | Detail |
|-------|--------|--------|
| Build (`tsc --noEmit`) | ✅ PASS | Sin errores |
| Tests nuevos | ⚠️ Sin tests | No se crearon tests automatizados |
| Migration SQL | ✅ PASS | ENUM + columnas + índices correctos |

### Issues

1. ⚠️ **Colisión de migration numbers** — mismo issue que WAS-281 (ambas son `076_`).
2. ℹ️ **`agent-signup/route.ts` no modificado** — listado en SDD como archivo a tocar, no se modificó. Si existe lógica de signup alternativa allí, el check de `account_status` podría no aplicarse en ese flujo.

---

## WAS-283 — Badge de salud de endpoint en marketplace UI

### Drift Detection

| Dimensión | Esperado (SDD) | Real (commit) | Status |
|-----------|---------------|---------------|--------|
| Archivos creados | `HealthBadge.tsx` | `HealthBadge.tsx` | ✅ OK |
| Archivos modificados | `agents/route.ts`, `models.types.ts`, `ModelCard.tsx`, `en.json`, `es.json` | ídem + `PublishPreview.tsx` | ⚠️ DRIFT (PublishPreview.tsx fuera de scope) |
| Dependencias nuevas | ninguna | ninguna | ✅ OK |

### AC Verification

| AC | Status | Evidencia | Test |
|----|--------|-----------|------|
| AC1: `/v1/agents` incluye `health_check` y `last_checked_at` | ✅ CUMPLE | `agents/route.ts:158` (slim path) y `:214-215` (full select) + `:335-336` (mapper) | — |
| AC2: `health_check.passed === true` → badge 🟢 Online | ✅ CUMPLE | `HealthBadge.tsx:30-38` — rama `if (healthCheck.passed)` con emoji 🟢 y `t('online')` | — |
| AC3: `health_check.passed === false` → 🔴 Down con tooltip "Last checked: X min ago" | ✅ CUMPLE | `HealthBadge.tsx:41-51` — rama else con emoji 🔴, `t('down')` y `title={checkedLabel}` donde `checkedLabel = t('last_checked', { minutes: minutesAgo })` | — |
| AC4: `last_checked_at === null` → ⚪ Not checked | ✅ CUMPLE | `HealthBadge.tsx:15-27` — `if (!lastCheckedAt \|\| healthCheck === null)` → emoji ⚪ + `t('not_checked')` | — |
| AC5: Textos del badge usan sistema i18n | ✅ CUMPLE | `HealthBadge.tsx:9` — `useTranslations('health_badge')`; `en.json:1154-1159`; `es.json:1154-1159` con traducciones en español | — |
| AC6: Badge tiene `aria-label` con texto del estado | ✅ CUMPLE | `HealthBadge.tsx:21` — `aria-label={t('not_checked')}`; `:37` — `aria-label={t('online')}`; `:49` — `aria-label={\`${t('down')} — ${checkedLabel}\`}` | — |

### Build & Tests

| Check | Result | Detail |
|-------|--------|--------|
| Build (`tsc --noEmit`) | ✅ PASS | Sin errores |
| Tests nuevos | ⚠️ Sin tests | No se crearon tests de componente |
| i18n en/es | ✅ PASS | Ambos archivos tienen `health_badge` con las 4 claves requeridas |

### Issues

1. ℹ️ **`PublishPreview.tsx` modificado en ambos WAS-281 y WAS-283** — fuera de scope en ambos SDDs. Revisar si los cambios son necesarios.

---

## Resumen Global

| Ticket | AC | CUMPLE | PARCIAL | NO CUMPLE | Build | Tests |
|--------|-----|--------|---------|-----------|-------|-------|
| WAS-281 | 7 | 7 | 0 | 0 | ✅ | ⚠️ sin tests |
| WAS-282 | 5 | 5 | 0 | 0 | ✅ | ⚠️ sin tests |
| WAS-283 | 6 | 6 | 0 | 0 | ✅ | ⚠️ sin tests |
| **TOTAL** | **18** | **18** | **0** | **0** | ✅ | ⚠️ |

## Issues Críticos (bloquean deploy)

| # | Severidad | Issue |
|---|-----------|-------|
| 1 | 🔴 CRÍTICO | **Colisión de migration numbers**: `076_add_account_status.sql` y `076_add_consecutive_failures.sql` — Supabase aplicará ambas, pero el orden puede ser indefinido. Renombrar uno (e.g. `077_add_consecutive_failures.sql`). |
| 2 | 🟡 MENOR | **`maxDuration = 120`** en WAS-281 — SDD especifica `60`. Vercel Pro crons tienen límite de 60s. Ajustar a `60`. |
| 3 | 🟡 MENOR | **`PublishPreview.tsx`** modificado sin estar en scope de ningún SDD. Requiere justificación o revert. |
| 4 | 🟡 MENOR | **`agent-signup/route.ts`** listado en SDD WAS-282 pero no modificado. Verificar si ese flujo de signup necesita el check de `account_status`. |
| 5 | ℹ️ INFO | Ningún ticket creó tests automatizados. Todos los ACs verificados por inspección de código. |

## Veredicto

- **WAS-281:** ✅ QA PASS — 7/7 ACs cumplidos. Issue crítico: colisión migration `076_` (bloquea deploy).
- **WAS-282:** ✅ QA PASS — 5/5 ACs cumplidos. Issue crítico: colisión migration `076_` (bloquea deploy).
- **WAS-283:** ✅ QA PASS — 6/6 ACs cumplidos. Sin issues críticos propios.

**Sprint B: QA PASS con observaciones — corregir colisión de migrations antes de `supabase db push`.**
