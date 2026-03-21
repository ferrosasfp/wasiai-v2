# Spec Review — SDD #258 — void Promise → after()

**Fecha:** 2026-03-20  
**Reviewer:** Spec Reviewer NexusAgil v1.3  
**Archivo objetivo:** `src/app/api/v1/models/[slug]/invoke/route.ts`

---

## Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix existe | ✅ PASS (NOT implemented) | Grep confirma 3 instancias de `void Promise.resolve(` en líneas 361, 506, 542 — fix no aplicado |
| 0.2 Archivos existen | ✅ PASS | `src/app/api/v1/models/[slug]/invoke/route.ts` existe |
| 0.3a Tipos correctos | ❌ FAIL | **CRÍTICO**: Ver Finding F1 — el patrón `try/catch` propuesto es incompatible con la API de Supabase para la instancia 2 |
| 0.3b Imports correctos | ✅ PASS | `next/server` ya importado; `after` se agrega al mismo import — válido. `logger` ya importado. |
| 0.4 Dependencias | ✅ PASS | No depende de SDD #256 ni de otros SDDs pendientes |
| 0.5 Completitud | ⚠️ PARCIAL | Rollback no especificado; pre-condición Next.js verificada: instalado 16.1.6 (`^16.0.0` en package.json) — `after()` disponible ✅ |

---

## Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ✅ PASS | AC1-3 en W2, AC4 implícito (after() guarantees post-response), AC5-6 verificables en W2/W3, AC7 (tsc) en W1 y W3 |
| Build gates | ✅ PASS | W1 tsc después del import, build gate entre cada instancia en W2, build final en W3 |
| Rollback | ❌ FAIL | No se especifica rollback ejecutable en ninguna wave |
| Constraints (≥3 PROHIBIDO) | ✅ PASS | 5 restricciones PROHIBIDO definidas |

---

## Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| F1 | 🔴 HIGH — BLOCKER | **Instancia 2: patrón try/catch insuficiente para Supabase**. La instancia 2 (`settlement_failures.insert`) tiene lógica `.then(res => { if (res.error) {...} else {...} })` — Supabase NO lanza excepciones en errores de DB; retorna `{ data, error }`. El patrón del SDD `after(async () => { try { await supabase.from(...).insert(...) } catch (err) {...} })` **NO capturará errores de DB-level** (res.error) — solo captura excepciones de red/JS. AC6 dice "preserva logging completo (success warn + error error con txHash)" pero el patrón propuesto lo rompe silenciosamente. | El Builder debe usar: `after(async () => { const res = await supabase.from('settlement_failures').insert({...}); if (res.error) { logger.error(..., { err: res.error.message, txHash }) } else { logger.warn(..., { slug, txHash }) } })` |
| F2 | 🟡 MEDIUM | **Instancia 1: cambio semántico warn→error**. La instancia 1 (receipt_signature) actualmente usa `logger.warn` para fallos. El patrón del SDD usa `logger.error`. AC5 dice "errores loggeados a logger.error" sin excepción — el SDD no preserva el nivel warn intencionado del código original. | Aclarar si el cambio de warn→error en instancia 1 es intencional. Si no, la instancia 1 debería mantener `logger.warn`. |
| F3 | 🟡 MEDIUM | **Instancia 3: mismo problema Supabase pero menor impacto**. `supabase.rpc('increment_pending_earnings', ...)` retorna `{ data, error }`, no lanza. Sin embargo, el código actual ya solo usa `.catch()` (sin chequear `res.error`), por lo que el patrón `try/catch` es funcionalmente equivalente al código actual — no es regresión. Pero **tampoco mejora** la captura de errores DB. | Documentar que errores DB-level de RPC no son capturados (comportamiento preservado, no empeorado). |
| F4 | 🟢 LOW | **Rollback ausente**. SDD no especifica cómo revertir si W2 o W3 fallan parcialmente (1 o 2 instancias migradas, build roto). | Agregar: "Rollback: `git checkout -- src/app/api/v1/models/[slug]/invoke/route.ts`" al inicio. |

---

## Veredicto

**NECESITA CORRECCIÓN**

**Blocker F1** impide aprobar: el patrón `try/catch` propuesto para la instancia 2 rompe el logging de errores DB-level de Supabase (que retorna `{ error }` sin lanzar). AC6 quedaría violado silenciosamente. El Builder heredaría un patrón que compila (AC7 ✅) pero falla en runtime en producción.

**Acciones requeridas antes de implementar:**
1. **[BLOCKER]** Corregir el patrón para instancia 2: usar `const res = await ...; if (res.error) { ... }` en lugar de `try/catch` puro
2. **[MEDIUM]** Clarificar intención del cambio warn→error en instancia 1
3. Agregar rollback ejecutable al SDD
