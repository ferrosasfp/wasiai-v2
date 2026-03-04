# Sprint 19 Review — "Security Hardening"

**Fecha:** 2026-03-03  
**Duración:** ~2h de sesión  
**Sprint:** 19 / NNN: 034  
**Estado:** ✅ CERRADO — 7/7 HUs completadas (100%)

---

## Resumen Ejecutivo

Sprint 100% completado en ~2h. Objetivo declarado en planning: cerrar todos los findings del audit de seguridad antes de la ventana Mainnet. Resultado: 8 de 9 findings cerrados (el noveno — NA-003 Parte B — fue diferido por decisión de infra, no por deuda técnica).

Los dos findings HIGH (NA-001 y NA-002) fueron resueltos primero, eliminando los riesgos de mayor impacto desde el inicio de la sesión. El único finding que requirió pipeline QUALITY completo (NA-004, rate limiter fail-closed) produjo 6 nuevos tests con cobertura de fallback de Upstash. El resto fueron FAST fixes limpios.

Forge confirma 151/151 tests pasando. No hubo incidentes durante el sprint.

WasiAI v2 queda en estado hardened: secrets protegidos, ABI sincronizado, endpoints internos autenticados, variables de entorno server-only, roles operador/admin separados, y rate limiter con comportamiento seguro ante fallos de infraestructura.

---

## HUs Completadas

| HU | Finding | Modo | Descripción | Commit |
|----|---------|------|-------------|--------|
| WAS-128 | NA-002 | FAST | Fix `.gitignore` — proteger `.env` y `.env.*` | `eca53dc` |
| WAS-129 | NA-001 | FAST | Fix ABI mismatch `setPlatformFee` → `proposeFee/executeFee/cancelFee` + `route.ts` 2-step | `b79f5c9` |
| WAS-130 | NA-005 | FAST | Auth `INTERNAL_API_SECRET` en 5 endpoints `agents-internal` + helper `verifyInternalSecret.ts` | `065391f` |
| WAS-131 | NA-010 | FAST | Rename `NEXT_PUBLIC_WASIAI_OWNER` → `WASIAI_OWNER_ADDRESS` en `verifyAdminSignature.ts` | `08550f2` |
| WAS-132 | NA-008+011 | FAST | Fix `divide-before-multiply` en test + refactor `onlyOperator` → `_checkOperator()` | `5c307cb` |
| WAS-134 | NA-004 | QUALITY (NNN-034) | Rate limiter fail-closed — 503 + `Retry-After: 60` cuando Upstash no disponible | `2d5a1af` |
| WAS-133 Parte A | NA-003 | FAST | Separar rol operador/admin — eliminar operador de `ALLOWED_ADDRESSES` | `869288f` |

**Commit final al master:** `869288f`

---

## Findings del Audit — Estado Final

| Finding | Severidad | Estado | HU | Sprint |
|---------|-----------|--------|----|--------|
| NA-001 — ABI mismatch `setPlatformFee` | HIGH | ✅ Cerrado | WAS-129 | S19 |
| NA-002 — `.gitignore` secrets expuestos | HIGH | ✅ Cerrado | WAS-128 | S19 |
| NA-003 Parte A — roles operador/admin | MEDIUM | ✅ Cerrado | WAS-133 | S19 |
| NA-004 — rate limiter fail-open | MEDIUM | ✅ Cerrado | WAS-134 | S19 |
| NA-005 — endpoints internos sin auth | MEDIUM | ✅ Cerrado | WAS-130 | S19 |
| NA-008 — divide-before-multiply en test | LOW | ✅ Cerrado | WAS-132 | S19 |
| NA-010 — variable server en NEXT_PUBLIC_ | INFO | ✅ Cerrado | WAS-131 | S19 |
| NA-011 — `onlyOperator` inline → helper | INFO | ✅ Cerrado | WAS-132 | S19 |
| NA-003 Parte B — Safe multisig 2-de-3 | MEDIUM | 🔒 Diferido | — | S20 |

> NA-003 Parte B no es deuda técnica. En testnet el EOA del owner es correcto. El Safe multisig es condición de entrada a Mainnet — se ejecuta en Sprint 20.

---

## Demo Highlights

### 🔴 HIGH → Resuelto: ABI mismatch (WAS-129)
- `setPlatformFee` no existía en el contrato desplegado. Las llamadas al contrato fallaban silenciosamente.
- Reemplazado por el flujo 2-step: `proposeFee` → `executeFee` (con `cancelFee` para rollback).
- `route.ts` actualizado para reflejar el nuevo flujo. ABI y frontend ahora sincronizados.

### 🔴 HIGH → Resuelto: Secrets en `.gitignore` (WAS-128)
- `.env` y `.env.*` no estaban en `.gitignore` — cualquier commit podía filtrar API keys.
- Regla agregada. Historial de git limpio (secrets nunca llegaron a commitearse).

### 🟡 MEDIUM → Resuelto: Rate limiter fail-closed (WAS-134)
- Antes: si Upstash no respondía, el rate limiter dejaba pasar todas las requests (fail-open).
- Ahora: timeout → 503 con header `Retry-After: 60`. Comportamiento seguro ante fallo de infra.
- 6 nuevos tests Vitest en `ratelimit-fallback.test.ts` cubriendo los escenarios de fallback.

### 🟡 MEDIUM → Resuelto: Endpoints internos sin auth (WAS-130)
- 5 rutas `agents-internal` accesibles sin autenticación desde cualquier cliente.
- Helper `verifyInternalSecret.ts` centraliza la validación de `INTERNAL_API_SECRET`.
- Todos los endpoints protegidos con 401 cuando el secret no coincide.

### 🟡 MEDIUM → Resuelto: Separación roles operador/admin (WAS-133)
- Operador y admin usaban el mismo address en `ALLOWED_ADDRESSES`.
- Roles ahora completamente separados — operador no tiene privilegios de admin.

---

## Métricas del Sprint

| Métrica | Valor |
|---------|-------|
| HUs cerradas | 7 / 7 (100%) |
| HUs modo FAST | 6 |
| HUs modo QUALITY | 1 (NNN-034) |
| Findings HIGH cerrados | 2 / 2 |
| Findings MEDIUM cerrados | 3 / 3 |
| Findings LOW/INFO cerrados | 3 / 3 |
| Findings diferidos | 1 (NA-003 Parte B — decisión de infra) |
| Tests Forge | 151 / 151 ✅ |
| Tests Vitest nuevos | 6 (ratelimit-fallback.test.ts) |
| Incidentes durante sprint | 0 |
| Duración de sesión | ~2h |
| Velocidad (HUs/h) | ~3.5 |

---

## Estado del Producto Post-Sprint 19

- ✅ Secrets protegidos — `.env` y `.env.*` en `.gitignore`
- ✅ ABI sincronizado — flujo `proposeFee/executeFee/cancelFee` correcto
- ✅ Endpoints internos autenticados — `INTERNAL_API_SECRET` en 5 rutas
- ✅ Variable server-only — `WASIAI_OWNER_ADDRESS` fuera del namespace `NEXT_PUBLIC_`
- ✅ Roles separados — operador ≠ admin en `ALLOWED_ADDRESSES`
- ✅ Rate limiter fail-closed — comportamiento seguro ante fallos de Upstash
- ✅ Contratos limpios — `_checkOperator()` helper, tests sin divide-before-multiply
- 🔒 **Pendiente pre-Mainnet:** Safe multisig 2-de-3 (NA-003 Parte B) — Sprint 20
- 🚀 **WasiAI v2 hardened — listo para condición de entrada Mainnet en Sprint 20**
