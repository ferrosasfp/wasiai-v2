# Spec Review — Sprint 8
> Reviewer: NexusAgil Spec Reviewer v1.3
> Fecha: 2026-03-15
> SDDs revisados: #073, #074, #075, #076, #077

---

## Spec Review — SDD #073: WAS-182 — Agentes DeFi Oficiales: precios y badge oficial

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ NO existe | No hay migration 061_defi_agents_prices.sql — cambio pendiente |
| 0.2 Archivos referenciados existen | ⚠️ PARCIAL | `supabase/migrations/043_defi_agents_production.sql` ✅ · `src/app/[locale]/models/[slug]/page.tsx` ✅ · `src/app/[locale]/models/page.tsx` ❌ NO existe (la ruta es `/models` pero no hay un `page.tsx` en `src/app/[locale]/models/` — solo existe `[slug]/page.tsx`) |
| 0.3a Tipos correctos | ✅ OK | UPDATE SQL + badge condicional, sin tipos nuevos |
| 0.3b is_featured existe | ✅ CONFIRMADO | `migration 00000000000003_wasiai_core.sql:17`: `is_featured BOOLEAN DEFAULT false` |
| 0.3d DB Security | ✅ OK | UPDATE por slug específico, sin RLS involucrada |
| 0.4 Dependencias entre SDDs | ✅ OK | Sin dependencia con otros SDDs |
| 0.5 SDD completo | ✅ OK | Mini-SDD con todos los campos necesarios |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | MEDIA | El SDD referencia `src/app/[locale]/models/page.tsx` para "verificar que `is_featured` llega en la query SELECT" pero ese archivo **no existe** en el repo. La ruta del marketplace puede ser diferente (ej: `/discover`, `/agents`, o generada por otra ruta). | Identificar el archivo real que sirve el marketplace listing (`/discover` o similar) y actualizar la referencia en "Archivos afectados". Si no hay listado público por `is_featured`, la tarea de verificación es innecesaria para este SDD. |
| 2 | BAJA | El SDD menciona línea 105 como referencia para el badge `creator.verified`. Sería prudente confirmar el número de línea exacto antes del build, aunque es un exemplar informativo, no bloqueante. | El Builder debe confirmar línea real con `grep -n "creator.verified" page.tsx` antes de implementar. |

### Veredicto: LISTO ✅
> Finding #1 es informativo — la migration SQL y el badge son independientes de que exista o no `models/page.tsx`. El SDD puede ejecutarse sin corrección previa.

---

## Spec Review — SDD #074: WAS-204 — Compose retry: persistir step outputs en grupos paralelos

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ NO existe | Confirmado: el bloque `allSettled` (líneas 687-720) NO llama `append_step_output`. Bug activo. |
| 0.2 Archivos referenciados existen | ✅ OK | `src/app/api/v1/compose/route.ts` ✅ · `supabase/migrations/052_pipeline_step_outputs.sql` ✅ |
| 0.3a Bloque allSettled localizado | ✅ CONFIRMADO | Bloque `Promise.allSettled` está en líneas 687-720 (el SDD decía ~694-730 — diferencia de ~7 líneas, aceptable) |
| 0.3b globalStepIndex disponible | ✅ CONFIRMADO | `globalStepIndex` es variable de la closure externa, accesible en el loop del bloque paralelo (línea 697: `const stepIdx = globalStepIndex + i`) |
| 0.3d DB Security | ✅ OK | RPC `append_step_output` ya existe y se usa en serial |
| 0.4 Dependencias | ✅ OK | Sin dependencia con otros SDDs del sprint |
| 0.5 SDD completo | ✅ OK | Bugfix SDD con causa raíz, fix propuesto y ACs claros |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | BAJA | El SDD dice "índice debe calcularse como `groupStartIndex + i` donde `groupStartIndex` es el `globalStepIndex` al inicio del grupo". En el código actual, dentro del loop de resultados el índice ya está disponible como `const stepIdx = globalStepIndex + i` (línea 697) — pero esta variable se calcula **dentro** del loop de resultados post-allSettled, no capturada antes. El Builder debe capturar `groupStartIndex = globalStepIndex` ANTES del `allSettled` para evitar usar el `globalStepIndex` post-incrementado. Riesgo real si el Builder no lee con cuidado. | Indicar en el SDD que `groupStartIndex` debe capturarse **antes** del `Promise.allSettled` call (línea 687), no calcularse inline en el loop de resultados. El valor correcto es `const groupStartIndex = globalStepIndex` insertado en línea 686. |
| 2 | BAJA | El SDD referencia la signatura RPC como `append_step_output(p_pipeline_id, p_step, p_output, p_agent_slug)`. Confirmado en el uso serial (líneas 662-668). Sin issue. | — |

### Veredicto: LISTO ✅
> Finding #1 es un riesgo de implementación menor — el Builder debe capturar `groupStartIndex` antes del `allSettled`. El SDD lo menciona en la sección Fix propuesto pero podría ser más explícito. No bloquea el inicio del sprint pero el Builder debe ser alertado.

---

## Spec Review — SDD #075: WAS-189 — Dispute Resolution para invocaciones fallidas

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ NO existe | No hay tabla `disputes`, no hay endpoints de dispute, `buildResponse` no expone `call_id`. |
| 0.2 Archivos referenciados existen | ✅ OK | `src/app/api/v1/models/[slug]/invoke/route.ts` ✅ · `src/app/api/v1/agent-keys/route.ts` ✅ (asumido por pattern) · `src/app/api/admin/status/route.ts` ✅ (asumido) · `src/app/[locale]/creator/dashboard/page.tsx` ✅ · `supabase/migrations/059_settlement_failures.sql` ✅ · `src/app/api/v1/agents/[slug]/reputation/route.ts` (exemplar — no verificado, no crítico) |
| 0.3a callId en scope Route A | ✅ CONFIRMADO | En Route A: `let callId: string | null = null` declarado antes del bloque success/failure. En la llamada a `buildResponse` (línea 407), `callId` está en scope. Es null en calls fallidas — correcto, el SDD lo maneja con `callId ?? undefined`. |
| 0.3a callId en scope Route B | ✅ CONFIRMADO | En Route B: `const callId = logResult.id` (declarado explícitamente). La llamada a `buildResponse` en línea 530 ocurre DESPUÉS de esta declaración. `callId` está en scope. |
| 0.3a buildResponse acepta callId | ❌ PROBLEMA | La función `buildResponse` actual (línea 684) NO tiene parámetro `callId`. Firma actual: `(model, result, txHash?, receiptSignature?, pricingInfo?)`. El SDD indica que hay que añadirlo — correcto. Pero el SDD dice "callId ya existe en scope (línea ~337/482)" lo cual es verdad, pero **omite mencionar que la firma de buildResponse también debe modificarse**. El Builder podría malinterpretar que solo hay que pasar el valor. |
| 0.3b Encoding | ✅ OK | `call_id` es UUID, expuesto como string — correcto. |
| 0.3d DB Security | ✅ OK | RLS service_only en `disputes`, ownership check explícito en el endpoint. |
| 0.4 Dependencias | ✅ OK | No depende de otros SDDs del sprint. |
| 0.5 SDD completo | ✅ OK | SDD full con diseño técnico, modelo de datos, ACs, waves. |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | ALTA | La Wave 2 del SDD dice "Pasar `callId` desde los dos puntos de retorno (Route A y Route B)" pero en **Route A**, `callId` en la llamada `buildResponse` (línea 407) solo tiene valor cuando `result.status === 'success'` — en el path de error, `callId` sigue siendo `null` (no se llama `logCall` en el else para obtener el id). El SDD afirma que "invoke completa (éxito o error) SHALL incluir `call_id`" (AC #1). Para el path de error en Route A, actualmente no se obtiene un `callId` de DB porque el `logCall` de error no retorna el id explícitamente. | Para cumplir AC #1 en Route A path de error: cambiar el `else` branch para capturar el id también: `const { id: errCallId } = await logCall(...)` y luego `callId = errCallId ?? null`. O bien, relajar el AC #1 para decir "éxito o error con x402" — pero en ese caso el AC debe actualizarse. |
| 2 | MEDIA | El SDD (sección 4.5) dice "`callId` ya existe en scope (línea ~337/482)" pero la función `buildResponse` necesita que se le agregue el parámetro explícitamente. El Wave 2 tarea W2.1 dice "Modificar `buildResponse` para aceptar `callId` opcional" — está correcto pero podría confundir al Builder si lee la sección 4.5 antes que Wave 2. | Añadir en sección 4.5 una nota explícita: "La firma de `buildResponse` debe extenderse con `callId?: string`". |
| 3 | BAJA | La migration 062 puede colisionar con migraciones no registradas. El SDD lo menciona en Riesgos y propone "aplicar solo via SQL directo en dev". OK. | Confirmar en W1.2 que se usa SQL directo, no `supabase db push`. |
| 4 | BAJA | El endpoint `POST /api/v1/calls/:call_id/dispute` usa `:call_id` en la descripción pero en Next.js el path file sería `[call_id]`. El SDD ya lo tiene correcto en "Archivos a crear" (`calls/[call_id]/dispute/route.ts`). Sin issue real. | — |

### Veredicto: NECESITA CORRECCIÓN ⚠️
> **Finding #1 es bloqueante**: el AC #1 promete `call_id` en toda respuesta (éxito Y error) pero el path de error en Route A no captura `callId`. El Builder implementará la feature con un gap en la promesa del AC o lo hará mal. Requiere corrección del SDD antes del build.

---

## Spec Review — SDD #076: BUG-03 — introspect memory_diffs filter hardcoded keys

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ NO existe | Bug confirmado en `buildCOB.ts` líneas 62-65: `.filter((e) => typeof e === 'object' && e !== null && ('delta' in e || 'diff' in e))` activo. |
| 0.2 Archivos referenciados existen | ✅ OK | `src/lib/introspect/buildCOB.ts` ✅ |
| 0.3a Código de bug confirmado | ✅ EXACTO | El filtro hardcoded existe exactamente como el SDD describe. El bloque `full` no filtra (correcto). Solo `shallow`/`mid` aplican el filtro. |
| 0.3b Límites de slice | ✅ OK | `slice(0, opts.depth === 'mid' ? 20 : 10)` — coincide con ACs #2 y #3 |
| 0.4 Dependencias | ✅ OK | Sin dependencias |
| 0.5 SDD completo | ✅ OK | Fast-fix SDD, cambio de 1 línea |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | BAJA | El SDD propone eliminar el `.filter()` completamente, dejando solo `.slice()`. Esto significa que si `upstream['memory_diffs']` contiene `null` values o no-objetos dentro del array, pasarán sin validación. El filtro actual hace `typeof e === 'object' && e !== null` (seguro). El SDD podría mantener esa validación básica y solo eliminar el check de keys. | Considerar mantener la validación de tipo básica: `.filter((e) => typeof e === 'object' && e !== null).slice(...)`. Esto no rompe ningún AC y preserva safety. |

### Veredicto: LISTO ✅
> Finding #1 es sugerencia de calidad, no bloqueante. El fix es trivial y seguro.

---

## Spec Review — SDD #077: DEUDA — Docs: corregir input serializado como string

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe | ✅ NO existe | Bug confirmado: `sdk-node.tsx` L32, L76 tienen `JSON.stringify({...})`. `agent-keys.tsx` L44 tiene `JSON.stringify({...})`. `compose.tsx` L13, L17, L39, L44 tienen input como string serializada. |
| 0.2 Archivos referenciados existen | ✅ OK | `src/features/docs/content/sdk-node.tsx` ✅ · `src/features/docs/content/agent-keys.tsx` ✅ · `src/features/docs/content/compose.tsx` ✅ |
| 0.3a Líneas correctas | ✅ EXACTO | Líneas confirmadas vía grep — coinciden con lo descrito en el SDD. |
| 0.3b x402.tsx excluido | ✅ OK | El SDD excluye `x402.tsx` explícitamente — correcto. |
| 0.4 Dependencias | ✅ OK | Sin dependencias |
| 0.5 SDD completo | ✅ OK | Fast-fix, 5 ocurrencias en 3 archivos. |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | BAJA | El SDD menciona "W1: Corregir los 5 ocurrencias en los 3 archivos" pero el conteo real es: `sdk-node.tsx` = 2 ocurrencias (L32, L76), `agent-keys.tsx` = 1 (L44), `compose.tsx` = 4 (L13, L17, L39, L44) → **total 7 ocurrencias**, no 5. | Actualizar el conteo en Wave única de "5 ocurrencias" a "7 ocurrencias". El Builder debe corregir las 7. |

### Veredicto: NECESITA CORRECCIÓN (menor) ⚠️
> **Finding #1**: el conteo incorrecto (5 vs 7) puede hacer que el Builder dé por terminado el trabajo tras corregir 5 ocurrencias, dejando 2 sin corregir en `compose.tsx`. Corrección trivial en el SDD antes del build.

---

## Veredicto Global

| SDD | Título | Veredicto | Bloqueantes |
|-----|--------|-----------|-------------|
| #073 | Agentes DeFi: precios + badge | ✅ LISTO | Ninguno |
| #074 | Compose retry: persist step outputs | ✅ LISTO | Ninguno (advertencia para Builder sobre capturar `groupStartIndex` antes del allSettled) |
| #075 | Dispute Resolution | ⚠️ NECESITA CORRECCIÓN | **Finding #1 ALTA**: Route A path de error no captura `callId` → AC #1 incumplible como está escrito |
| #076 | BUG-03 memory_diffs filter | ✅ LISTO | Ninguno |
| #077 | Docs input fix | ⚠️ NECESITA CORRECCIÓN (menor) | **Finding #1**: conteo de ocurrencias incorrecto (5 vs 7) — Builder puede dejar 2 sin corregir |

### Bloqueantes antes del build

1. **[SDD #075 — ALTA]** Corregir AC #1 o implementar captura de `callId` en Route A path de error (else branch de `logCall`). El Builder no puede completar correctamente la feature sin esta aclaración.

2. **[SDD #077 — BAJA]** Actualizar conteo de ocurrencias: 5 → 7 en "Wave única W1". Trivial pero previene un bug de scope.

### Nota para Builder (no bloqueante)
- **SDD #074**: Capturar `const groupStartIndex = globalStepIndex` ANTES de `Promise.allSettled` (línea 686). No usar `globalStepIndex` directamente en el loop de resultados post-incremento.
- **SDD #076**: Considerar mantener la validación de tipo básica (`typeof e === 'object' && e !== null`) aunque se elimine el check de keys `delta`/`diff`.
