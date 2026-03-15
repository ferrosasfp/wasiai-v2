# Spec Review — Sprint 7 WasiAI
> Reviewer: NexusAgil Spec Reviewer v1.3  
> Fecha: 2026-03-14  
> Revisados: 6 SDDs

---

## Resumen Ejecutivo

| SDD | Título | Veredicto |
|-----|--------|-----------|
| S7-01 | avaxBalance BigInt serialization fix | ✅ LISTO |
| S7-02 | min_performance slim + search paths | ✅ LISTO |
| S7-03 | Nonce x402 en agent_calls | ✅ LISTO |
| S7-04 | WAS-207 POST /introspect | ⚠️ NECESITA CORRECCIÓN |
| S7-05 | WAS-192 Non-custodial copy | ✅ LISTO |
| S7-06 | WAS-188 Reputación con ponderación | ⚠️ NECESITA CORRECCIÓN |

---

## S7-01 — avaxBalance BigInt serialization fix

**Veredicto: ✅ LISTO**

### Checklist
- **0.1 ¿Fix ya existe?** NO. El `.catch(() => 0n)` en `status/route.ts` línea ~37 no tiene logging. El bug es real y reproducible.
- **0.2 ¿Archivos existen?** ✅ `src/app/api/admin/status/route.ts` existe.
- **0.3a ¿Tipos y funciones correctas?** ✅ Casi. **Nota menor:** `OPERATOR_ADDRESS` ya está casteado como `` `0x${string}` `` en línea 8 a nivel de módulo (`const OPERATOR_ADDRESS = (process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? '') as `0x${string}``). El cast adicional en el fix propuesto es redundante pero inofensivo.
- **0.3b ¿Columnas DB correctas?** ✅ `status/route.ts` ya usa `called_at` correctamente en `agent_calls` (`.select('called_at')`, `.order('called_at', ...)`). Sin issue.
- **0.4 ¿Dependencias entre SDDs?** ✅ Ninguna.
- **0.5 ¿SDD completo?** ✅ Fix claro, AC concretos, scope acotado.

### Notas al Builder
- Remover el cast redundante `` as `0x${string}` `` en el fix (ya está en la declaración de módulo).
- `avaxBalanceError` es nuevo campo en response — ok per AC-2.

---

## S7-02 — min_performance en paths slim + search

**Veredicto: ✅ LISTO**

### Checklist
- **0.1 ¿Fix ya existe?** NO. Confirmado en `src/app/api/v1/agents/route.ts`:
  - Slim path (~línea 101): no aplica `gte('performance_score', minPerformance)`.
  - Search path (~línea 59): el RPC `search_agents` no recibe ni aplica `filter_min_performance`.
- **0.2 ¿Archivos existen?** ✅ `src/app/api/v1/agents/route.ts` existe.
- **0.3a ¿Tipos y funciones correctas?** ✅ `minPerformance` ya está validado y parseado antes de ambos paths. El fix de post-filtro en search es correcto: `agents.filter(a => !minPerformance || (a.performance_score ?? 0) >= minPerformance)`.
- **0.3b ¿Columnas DB correctas?** ✅ No hay queries a `agent_calls`. `performance_score` existe en `agents`.
- **0.4 ¿Dependencias?** ✅ Ninguna.
- **0.5 ¿SDD completo?** ✅ Dos opciones documentadas para search, se elige B (post-filtro JS). Correcto.

---

## S7-03 — Nonce x402 en agent_calls

**Veredicto: ✅ LISTO**

### Checklist
- **0.1 ¿Fix ya existe?** NO. `logCall()` en `invoke/route.ts` no acepta ni persiste `nonce`. Confirmado en firma y en el `.insert({...})`.
- **0.2 ¿Archivos existen?** ✅ `invoke/route.ts` existe.
- **0.3a ¿Tipos y funciones correctas?** ✅ `X402PaymentHeader` está definido en el mismo archivo con `authorization.nonce?: string`. El cast a `X402EVMPayload` para extraer nonce es correcto. El parámetro `nonce?: string | null` como opcional no rompe Route A.
- **0.3b ¿Columnas DB correctas?** ✅ Migración `060_nonce_agent_calls.sql` confirmada — columna `nonce TEXT` añadida con `ADD COLUMN IF NOT EXISTS`. Índice único parcial `idx_agent_calls_nonce_unique` creado (`WHERE nonce IS NOT NULL`).
- **0.4 ¿Dependencias?** ✅ Auto-contenido. No depende de otros SDDs del Sprint 7.
- **0.5 ¿SDD completo?** ✅ Flujo de idempotency (23505 unique violation → 402 `payment_already_used`) marcado como opcional pero bien descrito.

---

## S7-04 — WAS-207 POST /introspect

**Veredicto: ⚠️ NECESITA CORRECCIÓN**

### Checklist
- **0.1 ¿Fix ya existe?** NO (feature nueva). ✅
- **0.2 ¿Archivos existen?** ✅ Archivos referenciados como exemplars existen (`invoke/route.ts`, `signReceipt.ts`, `reputation/route.ts`).
- **0.3a ¿Tipos y funciones correctas?** ⚠️ **PROBLEMA CRÍTICO:** El SDD dice en sección 4.5 paso 9: `logCall() con payment_type='introspect'`. **Pero la firma actual de `logCall()` no acepta `payment_type`:**
  ```typescript
  async function logCall(
    supabase, model, callerType, agentId, txHash, result, keyId?, agentSlug?
  ): Promise<{ id? }>
  ```
  El insert tampoco incluye `payment_type`. La columna existe en `agent_calls` (usada en `status/route.ts` con `eq('payment_type', 'x402')`), pero `logCall` no la popula para ningún caller. Si el builder sigue el SDD al pie de la letra, el código no compilará o silenciosamente no registrará el tipo.

  **Corrección requerida:** El SDD debe especificar una de estas opciones:
  - A) Añadir parámetro `paymentType?: string | null` a `logCall()` (requiere update del scope a `invoke/route.ts` también)
  - B) O aclarar que el introspect call se registra con `payment_type = null` (y ajustar el AC correspondiente)

- **0.3a (adicional):** El SDD menciona "EIP-712 firmado" pero `signReceipt.ts` NO implementa EIP-712 real (no hay domain separator). Usa `keccak256(encodePacked(...))` + `signMessage`. El SDD en sección 6 dice "Firmar `keccak256(JSON.stringify(cob))` como bytes32 — simple y verificable" — esto está bien y es consistente con el patrón real. La mención de EIP-712 en ACs es imprecisa pero el diseño técnico la corrige.

- **0.3b ¿Columnas DB correctas?** ✅ `agent_calls` columns relevantes existen. `logCall()` usa `called_at` implícitamente (timestamp auto de DB).
- **0.4 ¿Dependencias?** ✅ No depende de otros SDDs activos.
- **0.5 ¿SDD completo?** ⚠️ Incompleto por el issue de `payment_type` en `logCall`.

### Corrección Requerida
```
Sección 4.5, paso 9: Especificar cómo se registra payment_type en logCall.
Opción recomendada (menor impacto): extender logCall con paymentType?: string | null
y pasarlo como 'introspect' desde el nuevo route. Actualizar scope IN para incluir
este cambio en invoke/route.ts (o definir logCall en lib/ si ya está planeado refactor).
```

---

## S7-05 — WAS-192 Claridad non-custodial

**Veredicto: ✅ LISTO**

### Checklist
- **0.1 ¿Fix ya existe?** NO. `messages/en.json` no tiene namespace `nonCustodial.*`. La landing no tiene badge non-custodial visible.
- **0.2 ¿Archivos existen?** ✅ `messages/en.json` existe. Los archivos de landing y onboarding están indicados como "Builder debe explorar" — correcto para un SDD MINI.
- **0.3a ¿Tipos y funciones correctas?** ✅ N/A (cambio de copy + UI).
- **0.3b ¿Columnas DB?** ✅ No aplica.
- **0.4 ¿Dependencias?** ✅ Ninguna.
- **0.5 ¿SDD completo?** ✅ Copy exacto provisto en sección 5 (EN + ES). ACs claros. Constraint de no inventar copy bien especificado.

### Notas al Builder
- Verificar que `messages/es.json` también existe (el SDD lo asume pero no lo lista explícitamente en los archivos a explorar).
- Reutilizar Badge/Tooltip componentes existentes antes de crear nuevos.

---

## S7-06 — WAS-188 Reputación con ponderación diferenciada

**Veredicto: ⚠️ NECESITA CORRECCIÓN**

### Checklist
- **0.1 ¿Fix ya existe?** NO. `calcScore()` en `reputation/route.ts` usa pesos fijos (40/30/20/10) sin ponderación por tipo de invocación.
- **0.2 ¿Archivos existen?** ✅ `src/app/api/v1/agents/[slug]/reputation/route.ts` existe.
- **0.3a ¿Tipos y funciones correctas?** ✅ Los campos `payment_type` e `is_trial` existen en `agent_calls` (confirmado por uso en `invoke/route.ts` y `status/route.ts`).
- **0.3b ¿Columnas DB correctas?** ⚠️ **PROBLEMA CRÍTICO — DOBLE ISSUE:**

  **Issue 1 — Nombre de índice incorrecto en SDD:**
  El SDD sección 5 PROHIBIDO dice: *"usar datos ya disponibles de `agent_calls` con el índice `idx_agent_calls_agent_created_at` (ya existe)"*
  
  **El índice correcto es `idx_agent_calls_agent_called_at`** — confirmado en migración `020_agent_calls_analytics_index.sql`:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_agent_calls_agent_called_at
    ON agent_calls (agent_id, called_at DESC);
  ```
  No existe ningún índice llamado `idx_agent_calls_agent_created_at`.

  **Issue 2 — Bug existente en `reputation/route.ts` que el builder puede replicar:**
  Las funciones `calcTrend()` y el query de `lastCall` en el archivo **ya tienen un bug**: usan `created_at` para consultar `agent_calls` cuando la columna correcta es `called_at`:
  ```typescript
  // BUGGY (líneas 66, 68, 73, 75, 136, 138, 168):
  .select('status, created_at')
  .gte('created_at', ...)
  .order('created_at', ...)
  lastCall?.created_at
  ```
  Si el builder sigue el patrón existente del archivo para la nueva query de breakdown (paidCount/keyCount/trialCount), **replicará este bug**. El SDD debe advertirlo explícitamente.

- **0.4 ¿Dependencias?** ✅ Ninguna.
- **0.5 ¿SDD completo?** ⚠️ Incompleto por el nombre de índice incorrecto y la ausencia de advertencia sobre `called_at`.

### Correcciones Requeridas

**Corrección 1 — Índice:**
```diff
- usar datos ya disponibles de `agent_calls` con el índice `idx_agent_calls_agent_created_at` (ya existe)
+ usar datos ya disponibles de `agent_calls` con el índice `idx_agent_calls_agent_called_at` (ya existe)
```

**Corrección 2 — Columna en nueva query:**
Añadir a sección 4.3 "Flujo principal" o a Constraint Directives:
```
⚠️ IMPORTANTE: En agent_calls la columna de timestamp es `called_at` (NO `created_at`).
Las queries existentes en este archivo tienen un bug usando `created_at` — NO replicarlo.
La nueva query de breakdown debe usar:
  .gte('called_at', new Date(Date.now() - 30 * 86400_000).toISOString())
```

**Opcional (recomendado):** Aprobechar este SDD para corregir el bug en `calcTrend()` y `lastCall` cambiando `created_at` → `called_at` (son queries silently failing porque Supabase puede retornar resultados vacíos o incorrectos si la columna no existe o retorna null para todos).

---

## Dependencias entre SDDs

```
S7-03 (nonce) → independiente
S7-04 (introspect) → usa logCall de invoke/route.ts (afecta S7-03 si se extiende logCall)
S7-06 (reputation) → independiente

Conflicto potencial: Si S7-03 extiende logCall() para añadir nonce,
y S7-04 también necesita extender logCall() para payment_type,
coordinar para no hacer dos PRs que modifiquen la misma función.
Recomendación: mergear S7-03 primero, S7-04 apila encima.
```

---

## Issues Bloqueantes (requieren corrección antes de implementar)

| # | SDD | Severidad | Descripción |
|---|-----|-----------|-------------|
| 1 | S7-04 | 🔴 BLOQUEANTE | `logCall()` no acepta `payment_type` — SDD incompleto |
| 2 | S7-06 | 🔴 BLOQUEANTE | Índice referenciado incorrecto (`created_at` vs `called_at`) — builder usará índice inexistente |
| 3 | S7-06 | 🟠 ALTO | No advierte al builder del bug `created_at` en archivo fuente — riesgo de replicación |

---

*Spec Review generado por NexusAgil Spec Reviewer v1.3 — 2026-03-14*
