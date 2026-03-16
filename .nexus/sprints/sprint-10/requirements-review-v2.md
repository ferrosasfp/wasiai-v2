# Requirements Review — Sprint 10 v2
**Reviewer:** NexusAgil Requirements Reviewer v1.3
**Fecha:** 2026-03-16
**Ronda:** 2 (post-SM revisions)
**Backlog revisado:** backlog-v2.md

---

## Resumen ejecutivo

| Issue | Ronda 1 | Ronda 2 | Δ |
|-------|---------|---------|---|
| WAS-216 | NO APROBADO | APROBADO CON OBSERVACIONES | ✅ Mejoró |
| WAS-217 | NO APROBADO | NO APROBADO | ⚠ Persiste gap crítico |
| WAS-218 | APROBADO CON OBSERVACIONES | APROBADO CON OBSERVACIONES | ↔ Mejoró parcialmente |
| WAS-223 | NO APROBADO | APROBADO CON OBSERVACIONES | ✅ Mejoró |
| WAS-224 | (nueva) | APROBADO CON OBSERVACIONES | — |

**Gaps cerrados en v2:** ~7 de los identificados en ronda 1 (fee flow, schema migración, amount_paid ≥ 0, deploy order, WAS-224 separación).
**Gaps nuevos introducidos:** 2 (AC-8 ambigüedad técnica, endpoint faltante WAS-217 AC-1).
**Gaps persistentes:** 4 (ver tabla de findings).

---

## Tabla de Findings

| # | Issue | AC | Severidad | Descripción |
|---|-------|----|-----------|-------------|
| F-01 | WAS-216 | AC-8 | **ALTA** | Implementación técnicamente ambigua: si `settleKeyBatch` deduce el total del keyBalance ANTES del loop, devolver los montos skipeados requiere lógica explícita de restitución. El AC dice "devuelto al keyBalance" pero no especifica si (a) se deduce solo al final por slug confirmado o (b) se deduce el total y se suma de vuelta. El contrato actual revierte, no tiene este path. Sin especificación clara el dev puede implementar mal y romper el invariante de solvencia. |
| F-02 | WAS-217 | AC-1 | **ALTA** | El endpoint `/api/creator/agents/on-chain-status` no existe actualmente y **ningún ticket lo crea explícitamente**. WAS-217 asume que existe como dependencia. Debe crearse como subtask de WAS-217 o como FAST-FIX propio. Sin esto, AC-1 bloquea todo el flujo. |
| F-03 | WAS-218 | AC-11 | **ALTA** | `spent_usdc_display = total_historico_depositado - budget_usdc_actual` — pero `total_historico_depositado` no existe como campo en el schema actual (`agent_keys` solo tiene `budget_usdc`, `spent_usdc`). Si `spent_usdc` se depreca como campo operacional, ¿dónde se persiste el histórico total depositado? Sin este campo, el cálculo del AC-11 es imposible. |
| F-04 | WAS-216 | AC-4 | **MEDIA** | `batchSelfRegister` debe cobrar `registrationFee` por agentes que excedan `freeRegistrationsPerUser`. El AC no especifica: ¿el contador es por sesión/tx o acumulado de por vida del creator? ¿Se incrementa el contador aunque la tx revierta a mitad? Falta especificar el storage del contador (`freeUsed[creator]`) y su comportamiento en revertes parciales (imposibles por D-2, pero debe confirmarse). |
| F-05 | WAS-216 | — | **MEDIA** | Sin AC para batch vacío: `batchSelfRegister([])` — ¿debe revertir o es no-op? Sin AC, el dev decide arbitrariamente. Recomendación: revertir con "WasiAI: empty batch". |
| F-06 | WAS-216 | — | **MEDIA** | Sin AC para tamaño máximo de batch en `batchSelfRegister`. Batches de 500+ slugs podrían exceder el gas limit del bloque. Sin límite explícito, hay vector de DoS o tx fallida silenciosa. |
| F-07 | WAS-217 | AC-5 | **MEDIA** | "UI DEBE mostrar costo de gas estimado" — no especifica quién/cómo estima el gas (eth_estimateGas, valor hardcodeado, etc.). En Base (L2 con L1 data fee) la estimación de gas es no-trivial. Sin especificación, el dev puede hardcodear un valor o no implementarlo. |
| F-08 | WAS-217 | AC-10 | **MEDIA** | "Agentes sin `erc8004Id` configurado en DB" — el schema de `agents` en el contexto no muestra columna `erc8004_id`. ¿Existe? ¿Es nullable hoy? Si no existe, WAS-217 tiene una dependencia de schema no declarada. |
| F-09 | WAS-223 | AC-7 | **MEDIA** | Regla de backfill `amount_paid = 0 AND key_id IS NULL → free_trial` es demasiado amplia. Una call x402 fallida tendría `tx_hash IS NULL`, `key_id IS NULL`, `amount_paid = 0`. Colisiona con el caso free_trial. Se necesita al menos un tercer discriminador (ej: campo `endpoint` o `source`). |
| F-10 | WAS-224 | — | **MEDIA** | WAS-224 tiene overlap significativo con WAS-223 AC-1 a AC-4 (ambos auditan + corrigen insert paths). El riesgo es trabajo duplicado o cambios conflictivos si se ejecutan en paralelo sin coordinación. Debe marcarse que WAS-224 es el AC-1 de WAS-223 externalizado, y WAS-223 AC-1 debe referenciarlo en lugar de redefinirlo. |
| F-11 | WAS-224 | AC-3 | **MEDIA** | La clasificación como **FAST-FIX** es incorrecta. AC-3 implica modificar handlers de producción (invoke routes, x402Handler) — código crítico de monetización. Esto requiere PR review, tests de regresión y QA en staging. Debe reclasificarse como **HU-MINOR** o **TASK** con criterios de done incluidos. |
| F-12 | WAS-216 | AC-30 | **INFO** | AC-30 menciona `recordInvocation` como función que "permanece igual". Sin embargo, con la nueva arquitectura (earnings[creator] only, slugs on-chain) conviene verificar explícitamente que `recordInvocation` no necesita cambios para alimentar correctamente `earnings[creator]`. Si actualmente acredita a `agentEarnings[slug]`, el cambio D-1 implica modificarla — lo cual sería un breaking change no declarado. |
| F-13 | WAS-218 | AC-7 | **INFO** | "Esperar confirmación on-chain (1 bloque)" — no especifica el mecanismo: ¿polling de tx receipt? ¿webhook de Alchemy/QuickNode? Sin especificación el dev decide y puede introducir race conditions. |
| F-14 | WAS-217 | AC-13 | **INFO** | AC-13 dice "detectar vía on-chain que Paso 1 ya está completo" — pero no especifica qué llamada on-chain hace esto. ¿Llama a `getAgent(slug)` para cada slug unregistered? ¿Cuántos slugs puede tener un creator? Si son muchos, puede ser lento. Agregar: "usando el mismo endpoint AC-1 con caché de 30s". |

---

## Análisis de preguntas especiales del SM

### ¿D-1 (solo earnings[creator]) crea problemas en el flujo de withdraw?

**Respuesta: No directamente, pero hay una implicación no documentada.**

El contrato no necesita saber qué agentes pertenecen a un creator — durante `settleKeyBatch`, por cada slug registrado, busca su `creator_wallet` y hace `earnings[creator_wallet] += amount`. El acumulado es correcto.

**Implicación no documentada:** Si el creator quiere ver "cuánto ganó por agente X", eso debe venir de la DB (`agent_calls` + `creator_profiles`). El AC-13 de WAS-216 lo declara explícitamente. **Pero falta un AC en WAS-217/WAS-218 que confirme que la UI del dashboard muestra breakdown por agente desde DB, no del contrato.** Actualmente el dashboard podría estar leyendo del contrato para eso.

### ¿AC-8 de WAS-216 es técnicamente correcto?

**Respuesta: Ambiguo — riesgo ALTO.**

Si el contrato actual (o el nuevo) implementa `settleKeyBatch` como:
```
uint256 total = sum(amounts);
keyBalance[keyId] -= total;  // ← deducción upfront
for each slug: earnings[creator] += amount;
```

Entonces para los slugs skipeados el monto ya fue deducido del keyBalance pero no se acreditó a nadie. El AC-8 dice "devuelto al keyBalance" pero no dice **cómo**. La implementación correcta es:

```
// Opción A (recomendada): no deducir upfront, solo deducir lo que se acredita
uint256 settled = 0;
for each slug:
  if registered: earnings[creator] += amount; settled += amount;
keyBalance[keyId] -= settled;

// Opción B: deducir upfront y sumar de vuelta los skips
uint256 skipped = 0;
for each slug:
  if !registered: skipped += amount;
keyBalance[keyId] -= (total - skipped);
```

**El AC debe especificar cuál opción y agregar un test Foundry para este path exacto.**

### ¿El endpoint `/api/creator/agents/on-chain-status` existe? ¿Quién lo crea?

**Respuesta: No existe, y nadie lo crea en el backlog actual. Gap ALTO.**

WAS-217 AC-1 lo consume pero ningún ticket lo crea. Necesita ser creado como subtask de WAS-217 (backend) o como FAST-FIX separado que sea prerequisito de WAS-217. La implementación requiere: auth (wallet del creator), leer `agents` table de DB, para cada slug llamar `getAgent(slug)` on-chain (o leer del contrato si hay índice), comparar y retornar `{ registered, unregistered }`.

### ¿WAS-224 es FAST-FIX o HU-MINOR? ¿Puede ejecutarse en paralelo con WAS-216?

**Respuesta: Debe ser HU-MINOR o TASK. Sí puede ejecutarse en paralelo con WAS-216.**

- **Clasificación:** AC-3 de WAS-224 es "corregir cada path" — eso es desarrollo + PR + tests. Un FAST-FIX es un hotfix de 1-2 líneas. Reclasificar como TASK o HU-MINOR.
- **Paralelismo con WAS-216:** Sí, es completamente independiente. WAS-224 toca Node.js (API routes), WAS-216 toca Solidity. No hay dependencia técnica. **Pero** WAS-224 debe completarse antes de que WAS-223 aplique constraints, no antes de WAS-216.
- **Overlap con WAS-223:** WAS-224 AC-1 a AC-4 solapan exactamente con WAS-223 AC-1 a AC-4. O bien WAS-224 se fusiona en WAS-223, o WAS-223 AC-1 a AC-4 se reemplazan por "DEPENDS ON WAS-224".

---

## ACs adicionales sugeridos (solo gaps nuevos — no repetidos de ronda 1)

### WAS-216

```
AC-8b: La implementación de settleKeyBatch SHALL deducir del keyBalance ÚNICAMENTE
       los montos efectivamente acreditados (Opción A: deducción post-loop).
       Test Foundry: batch con 3 slugs (2 registrados + 1 skipeado) → keyBalance
       decrementado en suma de los 2 registrados solamente.

AC-NEW-1: batchSelfRegister SHALL revertir con "WasiAI: empty batch" si slugs[]
          tiene longitud 0.

AC-NEW-2: batchSelfRegister SHALL revertir con "WasiAI: batch too large" si
          slugs[].length > MAX_BATCH_SIZE (definir MAX_BATCH_SIZE, sugerido: 50).

AC-NEW-3: batchSelfRegister SHALL revertir con "Pausable: paused" si el contrato
          está en estado paused (verificar modifier whenNotPaused en la función).
```

### WAS-217

```
AC-NEW-4: Backend SHALL implementar GET /api/creator/agents/on-chain-status
          (autenticado por wallet) que:
          (a) lee agents[] del creator desde DB
          (b) para cada slug, llama getAgent(slug) on-chain
          (c) retorna { registered: string[], unregistered: string[] }
          (d) cachea resultado 60s por creator para evitar spam RPC

AC-NEW-5: Si /api/creator/agents/on-chain-status falla (RPC timeout), la UI
          SHALL mostrar error explícito "No se pudo verificar estado on-chain.
          Intenta de nuevo." y NO deshabilitar el botón de withdraw.
```

### WAS-218

```
AC-NEW-6: Migración DB SHALL agregar columna total_deposited_usdc NUMERIC(18,6)
          DEFAULT 0 a agent_keys, poblada desde el historial de depositForKey
          events (o desde budget_usdc actual como seed inicial).
          Esta columna es la base para el cálculo de AC-11.
          (Alternativa aceptable: calcular desde sum(deposits) en tabla separada
          si existe — especificar cuál es la fuente.)
```

### WAS-223

```
AC-NEW-7: Regla de backfill para rows ambiguas (amount_paid = 0, key_id IS NULL,
          tx_hash IS NULL) → marcar payment_type = 'unknown' (no asumir free_trial).
          La regla free_trial debe requerir además: source = 'free_trial' OR
          un campo discriminador adicional. Agregar columna source TEXT si no existe.
```

---

## Veredicto por issue

### WAS-216 — APROBADO CON OBSERVACIONES
- **Bloqueo:** F-01 (AC-8 ambigüedad técnica) debe resolverse antes de SDD. Agregar AC-8b.
- **No bloqueantes:** F-04, F-05, F-06, F-12 deben incorporarse como ACs o documentarse en SDD.
- **Positivo:** D-1, D-2, D-3 bien definidos. Tests Foundry bien cubiertos (AC-18 a AC-24). NatSpec incluido.

### WAS-217 — NO APROBADO
- **Bloqueo:** F-02 (endpoint faltante). No puede implementarse el flujo sin el backend que lo soporte.
- **Bloqueo secundario:** F-08 (erc8004_id en schema). Si el campo no existe, AC-10 no es implementable.
- **Acción requerida:** Crear subtask para el endpoint, o agregar AC-NEW-4 a esta issue.

### WAS-218 — APROBADO CON OBSERVACIONES
- **Bloqueo:** F-03 (total_deposited ausente del schema). AC-11 es irrealizable sin este campo o su equivalente.
- **No bloqueante:** F-13 (mecanismo de confirmación on-chain). Puede resolverse en diseño técnico.
- **Positivo:** D-1 a D-4 claros. balance_synced_at correcto. Rate limit en sync manual bien especificado.

### WAS-223 — APROBADO CON OBSERVACIONES
- **No bloqueante:** F-09 (regla backfill ambigua). Debe refinarse antes de ejecutar en prod.
- **No bloqueante:** F-10 (overlap WAS-224). Requiere coordinación editorial, no es técnico.
- **Positivo:** Orden de deploy en 2 fases correcto. amount_paid >= 0 correcto. Índice incluido.

### WAS-224 — APROBADO CON OBSERVACIONES
- **No bloqueante:** F-11 (clasificación incorrecta). Reclasificar como TASK.
- **No bloqueante:** F-10 (overlap con WAS-223). Requiere que WAS-223 AC-1..4 referencien WAS-224 en lugar de duplicarlo.
- **Positivo:** Separación del audit como pre-requisito fue la decisión correcta. El scope está claro.

---

## Comparación Ronda 1 → Ronda 2

| Categoría | Ronda 1 | Ronda 2 |
|-----------|---------|---------|
| Issues NO APROBADAS | 3 | 1 (WAS-217) |
| Findings ALTA | ~4 | 3 |
| Findings MEDIA | ~6 | 8 (algunos son nuevos introducidos por cambios v2) |
| ACs faltantes críticos | ~12 | 5 |
| Decisiones de arquitectura documentadas | 0 | 9 (D-1 a D-3 por issue) |

**Mejora neta:** Significativa. Las D-x documentadas son el mayor avance — eliminan ambigüedad de diseño que en ronda 1 estaba completamente ausente. Los gaps que persisten son más finos y técnicos. El único bloqueo real para el sprint es WAS-217 (endpoint faltante) y los detalles de AC-8 en WAS-216.

**Riesgo principal del sprint:** Si WAS-224 y WAS-216 se ejecutan en paralelo sin coordinación de interfaces, el cambio de `settleKeyBatch` (skip en lugar de revert) puede no ser reflejado correctamente en los paths corregidos por WAS-224/WAS-223.

---

*Generado por NexusAgil Requirements Reviewer v1.3 — Sprint 10 Review Round 2*
