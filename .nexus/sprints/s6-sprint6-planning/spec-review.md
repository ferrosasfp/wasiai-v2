# Spec Review — Sprint 6 WasiAI

> Reviewer: NexusAgil Spec Reviewer v1.3
> Fecha: 2026-03-15
> SDDs revisados: 5

---

## Tabla de Findings por SDD

| SDD | Checklist | Severity | Finding |
|-----|-----------|----------|---------|
| S6-01 | 0.3b | ⚠️ WARN | Context Map dice `agent_calls.settlement_tx_hash` pero la columna real es `tx_hash` (ver `logCall()` línea ~593). No bloquea implementación (nueva tabla `settlement_failures` tiene su propia columna), pero documentación incorrecta puede confundir al implementador. |
| S6-01 | 0.5 | ⚠️ WARN | Ambigüedad: ¿de dónde extrae el implementador `caller_wallet` para el insert a `settlement_failures`? No está especificado (probablemente `payment.from` del payload x402). |
| S6-02 | 0.3a | ⚠️ WARN | `payment_type` existe en `agent_calls` (migration 032, `DEFAULT 'x402'`) ✅. Pero `avaxBalance` ya existe en la respuesta de `/api/admin/status`. El SDD añade `operator_avax_balance` dentro de `x402_health` — habrá duplicación. El SDD no indica si se debe eliminar el campo `avaxBalance` de nivel raíz ni reconciliar con `avaxBalanceLow`. |
| S6-02 | 0.4 | 🔴 BLOCK | Depende de `settlement_failures` (S6-01). El SDD lo declara correctamente, pero debe ejecutarse en orden: S6-01 → S6-02. |
| S6-A1 | 0.1 | 🔴 BLOCK | **El índice ya existe.** Migration `020_agent_calls_analytics_index.sql` crea `idx_agent_calls_agent_called_at ON agent_calls (agent_id, called_at DESC)` — idéntico al índice propuesto. La migración 061 sería completamente redundante. |
| S6-A1 | 0.5 | 🔴 BLOCK | **Naming bug:** el SDD propone `idx_agent_calls_agent_created_at` (nombre dice `created_at`) pero la columna es `called_at`. Inconsistencia nombre vs columna. |
| S6-A1 | 0.3a | 🔴 BLOCK | `CREATE INDEX CONCURRENTLY` no puede ejecutarse dentro de una transacción. Las migraciones de Supabase corren en transacciones. Se debe usar `CREATE INDEX IF NOT EXISTS` (sin `CONCURRENTLY`) en scripts de migración. |
| S6-A3 | 0.1 | 🔴 BLOCK | **El bug no existe actualmente.** `src/app/api/v1/agents/route.ts` no lee el query param `min_performance` — el param es ignorado silenciosamente, nunca llega a Supabase. El escenario de repro del SDD (`GET /api/v1/agents?min_performance=abc`) no produce NaN en ningún query. |
| S6-A3 | 0.5 | ⚠️ WARN | Ambigüedad crítica: ¿este SDD debe TAMBIÉN exponer el param `min_performance` en la route (leyendo el `searchParams`) y añadir la validación? Si solo añade el guard sin leer el param, el código es letra muerta. El SDD no clarifica si la exposición del param es in-scope. |
| S6-03 | 0.1 | ✅ OK | No existe columna `nonce` ni índice en `agent_calls`. Fix genuino. |
| S6-03 | 0.5 | ⚠️ WARN | El SDD menciona crear/modificar `README.md` o `docs/architecture/payments.md` pero no especifica cuál de los dos ni el contenido mínimo esperado. Ambigüedad baja (mini SDD), pero el implementador debe elegir. |

---

## Detalle por SDD

### S6-01 — Error Recovery Post-Settlement

| Check | Estado | Detalle |
|-------|--------|---------|
| 0.1 Fix ya existe | ✅ No | `settlement_failures` no existe en codebase |
| 0.2 Archivos existen | ✅ Sí | `invoke/route.ts`, `admin/status/route.ts`, `058_performance_score.sql` todos presentes |
| 0.3a Código compila | ✅ Sí | `logger.error`, fire-and-forget pattern, `logCall` return `{ id }` — todo disponible |
| 0.3b Columnas DB | ⚠️ Warn | Context Map lista `settlement_tx_hash` en `agent_calls` pero la columna es `tx_hash`. La nueva tabla `settlement_failures` puede tener el nombre que quiera — no bloquea. |
| 0.3d DB Security | ✅ OK | Nueva tabla con `SECURITY DEFINER` no aplica. No hay SQL RLS mencionado — aceptable para tabla admin-only. Recomendación: añadir RLS `FOR SELECT TO service_role` para consistencia. |
| 0.4 Dependencias | ✅ OK | Ninguna nueva. `createServiceClient` ya disponible. |
| 0.5 Completo | ⚠️ Warn | Falta especificar origen de `caller_wallet` en el insert (¿`payment.from`?). |

**Veredicto: NECESITA CORRECCIÓN** (menores — no bloquean, pero deben aclararse antes de implementar)

---

### S6-02 — Observabilidad x402

| Check | Estado | Detalle |
|-------|--------|---------|
| 0.1 Fix ya existe | ✅ No | No hay `x402_health` ni logs `[x402]` en codebase |
| 0.2 Archivos existen | ✅ Sí | Todos presentes. `usdcSettler.ts` referenciado existe. |
| 0.3a Código compila | ✅ Sí | `getPublicClient()` ya importado en `admin/status/route.ts`. `OPERATOR_ADDRESS` ya definido. `logger.info` disponible. `getIdentifier` disponible en invoke/route.ts. |
| 0.3b Columnas DB | ✅ OK | `agent_calls.called_at` ✅, `agent_calls.payment_type` ✅ (migration 032), `settlement_failures.created_at` ✅ (S6-01) |
| 0.3d DB Security | ✅ OK | Solo SELECTs de lectura, sin SQL peligroso |
| 0.4 Dependencias | 🔴 Block | Requiere S6-01 ejecutado primero |
| 0.5 Completo | ⚠️ Warn | `avaxBalance` ya en respuesta raíz de admin/status. SDD no dice qué hacer con el campo existente. Riesgo de respuesta confusa con `avaxBalance` y `x402_health.operator_avax_balance` en paralelo. |

**Veredicto: NECESITA CORRECCIÓN** (aclarar deduplicación de avaxBalance; dependencia S6-01 documentada pero debe ser explícita en planning)

---

### S6-03 — Formalizar WAS-132

| Check | Estado | Detalle |
|-------|--------|---------|
| 0.1 Fix ya existe | ✅ No | Columna `nonce` no existe en `agent_calls` |
| 0.2 Archivos existen | ✅ Sí | `invoke/route.ts` existe; migración a crear |
| 0.3a Código compila | ✅ Sí | `logCall()` no se toca — columna nullable, sin cambios en TS |
| 0.3b Columnas DB | ✅ OK | `ADD COLUMN IF NOT EXISTS nonce TEXT` — correcto |
| 0.3d DB Security | ✅ OK | `UNIQUE INDEX` parcial `WHERE nonce IS NOT NULL` — correcto y seguro |
| 0.4 Dependencias | ✅ OK | Ninguna |
| 0.5 Completo | ⚠️ Warn | No especifica `README.md` vs `docs/architecture/payments.md` — menor |

**Veredicto: LISTO** (con nota: aclarar qué archivo doc modificar)

---

### S6-A1 — Índice agent_calls(agent_id, called_at)

| Check | Estado | Detalle |
|-------|--------|---------|
| 0.1 Fix ya existe | 🔴 BLOCK | **Índice ya existe**: `migration/020_agent_calls_analytics_index.sql` crea `idx_agent_calls_agent_called_at ON agent_calls (agent_id, called_at DESC)` — idéntico |
| 0.2 Archivos existen | ✅ Sí | Migración a crear |
| 0.3a Código compila | 🔴 Block | `CREATE INDEX CONCURRENTLY` no permitido en transacciones de migración |
| 0.3b Columnas DB | 🔴 Block | Nombre del índice `idx_agent_calls_agent_created_at` inconsistente con columna `called_at` |
| 0.3d DB Security | N/A | Solo índice |
| 0.4 Dependencias | ✅ OK | Ninguna |
| 0.5 Completo | 🔴 Block | Múltiples problemas acumulados — SDD necesita reescribirse o cancelarse |

**Veredicto: NECESITA CORRECCIÓN** — Opciones:
1. **Cancelar S6-A1**: el índice ya existe, la deuda de Sprint 5 Retro está cubierta. Documentar en retro.
2. **Si se mantiene**: eliminar `CONCURRENTLY`, corregir nombre a `idx_agent_calls_agent_called_at_v2` o verificar que la nueva migración hace `CONCURRENTLY` fuera de transacción con `SET LOCAL lock_timeout`.

---

### S6-A3 — NaN Guard min_performance

| Check | Estado | Detalle |
|-------|--------|---------|
| 0.1 Fix ya existe | 🔴 Block | El param `min_performance` no existe en `agents/route.ts` — el bug no se puede reproducir |
| 0.2 Archivos existen | ✅ Sí | `agents/route.ts` existe |
| 0.3a Código compila | ✅ Sí | El fix propuesto es TypeScript válido |
| 0.3b Columnas DB | ✅ OK | `performance_score` existe en agents (migration 058) |
| 0.3d DB Security | ✅ OK | Solo lectura |
| 0.4 Dependencias | ✅ OK | Ninguna |
| 0.5 Completo | ⚠️ Warn | ¿El scope incluye exponer el param `min_performance` en la route? Si sí, el SDD debe añadirlo explícitamente. Si no, el guard es código muerto. |

**Veredicto: NECESITA CORRECCIÓN** — Acción requerida: aclarar si este SDD TAMBIÉN añade `searchParams.get('min_performance')` a la route (lo cual sería el fix real + guard), o si es solo un guard defensivo que también requiere exponer el param.

---

## Resumen Ejecutivo

| SDD | Veredicto | Bloqueantes |
|-----|-----------|------------|
| S6-01 Error Recovery | ⚠️ NECESITA CORRECCIÓN | Menores: aclarar origen de `caller_wallet`, corregir nombre de columna en Context Map |
| S6-02 x402 Observability | ⚠️ NECESITA CORRECCIÓN | Deduplicar `avaxBalance` en respuesta; dependencia explícita S6-01 |
| S6-03 WAS-132 Formalize | ✅ LISTO | — |
| S6-A1 agent_calls index | 🔴 NECESITA CORRECCIÓN | Índice duplicado (ya existe en 020), `CONCURRENTLY` inválido en migration, naming bug |
| S6-A3 NaN Guard | 🔴 NECESITA CORRECCIÓN | Bug no existe actualmente — SDD ambiguo sobre si expone el param |

### Orden de implementación recomendado

```
S6-01 → S6-02 (depende de S6-01)
S6-03 (independiente)
S6-A1 → CANCELAR o reescribir (índice ya existe)
S6-A3 → Aclarar scope antes de implementar
```

### Acciones inmediatas antes del Sprint Start

1. **S6-01**: Clarificar en SDD cómo obtener `caller_wallet` (ej: `paymentPayload.from ?? null`). Corregir Context Map: `tx_hash` no `settlement_tx_hash`.
2. **S6-02**: Aclarar qué pasa con `avaxBalance` de nivel raíz: ¿se elimina, se mantiene, o se unifica bajo `x402_health`?
3. **S6-A1**: Decidir si cancelar (deuda ya cubierta por migration 020) o reescribir sin `CONCURRENTLY` y con nombre correcto.
4. **S6-A3**: Añadir al scope: `searchParams.get('min_performance')` + `discoverAgent` call con el valor validado, o reclasificar como pre-emptive guard pendiente de futura exposición del param.

---

*Generado por NexusAgil Spec Reviewer v1.3 — Sprint 6 WasiAI*
