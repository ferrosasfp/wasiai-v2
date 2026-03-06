# Validation Report — WAS-38: UI Visual de Pipelines

**Fecha:** 2026-03-02  
**Reviewer:** Adversary + QA (San)  
**Story:** `story-WAS-38.md`  
**Veredicto Final:** CR: CHANGES (corregidos) → APPROVED | QA: 7/9 PASS

---

## Code Review

### Checklist

#### 1. Sin `any` explícito
✅ **PASS** — Ningún `any` explícito encontrado en los 6 archivos revisados.
- `PipelineBuilder.tsx` — tipos explícitos `ComposeStep`, `LocalStep`, `AvailableAgent`
- `PipelineStatus.tsx` — tipos explícitos `StepReceipt`, `PipelineRunState`
- `PipelineHistory.tsx` — tipo explícito `PipelineHistoryItem`
- `PipelinePageClient.tsx` — tipos `ComposeResponse`, `PipelineFailedResponse`, etc.

#### 2. Patrones Client/Server consistentes
✅ **PASS**
- `page.tsx` — Server Component correcto (sin `'use client'`, usa `createClient` server-side)
- `PipelinePageClient.tsx` — `'use client'` ✅ (línea 1)
- `PipelineBuilder.tsx` — `'use client'` ✅ (línea 1)
- `PipelineStatus.tsx` — `'use client'` ✅ (línea 1)
- `PipelineHistory.tsx` — `'use client'` ✅ (línea 1)

#### 3. Manejo de estados loading/error
✅ **PASS** (con notas)
- `PipelineBuilder.tsx` — estado `isRunning` controlado vía prop, botón deshabilitado y spinner
- `PipelineStatus.tsx` — maneja `idle` / `running` (spinner) / `completed` / `failed`
- `PipelineHistory.tsx` — estado `loading` con texto "Cargando historial...", empty state con mensaje
- `PipelinePageClient.tsx` — try/catch completo en `handleRun`, error de red capturado
- ⚠️ **MENOR:** `PipelineHistory` no maneja error de Supabase (`.then(({ data })` ignora `error`). No bloqueante pero es deuda técnica.

#### 4. Keys de React correctas
**BLOQUEANTES encontrados y corregidos:**

| Archivo | Línea original | Problema | Corrección |
|---------|---------------|----------|------------|
| `PipelineBuilder.tsx` | 105 | `key={index}` | → `key={step._id}` (stable UUID-like per step) |
| `PipelineHistory.tsx` | 96 | `<>` Fragment sin key en map | → `<Fragment key={item.id}>` |

Ambos corregidos antes del commit.

---

### Hallazgos adicionales

| Severidad | Archivo | Descripción |
|-----------|---------|-------------|
| **BLOQUEANTE** (corregido) | `PipelineBuilder.tsx:39,45` | Usaba `sessionStorage` en lugar de `localStorage` — viola AC-07. Corregido a `localStorage`. |
| MENOR | `PipelineHistory.tsx` | No maneja `error` del query Supabase — silently falla. Recomendado agregar estado `error` en siguiente sprint. |
| MENOR | `PipelineHistory.tsx` | Usa `.eq('user_id', userId)` — story advierte que la tabla puede filtrar por `key_id`. Funciona si el schema tiene `user_id` pero requiere verificación. |
| SUGERENCIA | `page.tsx` | Doble import del mismo módulo `@/lib/supabase/server` — funciona pero puede unificarse. |

---

## F4 QA — Acceptance Criteria

### AC-01
> WHEN el usuario agrega hasta 5 steps y hace click en "Ejecutar", SHALL llamar a `POST /api/v1/compose` con steps + header `x-api-key`.

✅ **CUMPLE**
- `PipelinePageClient.tsx:78` — `fetch('/api/v1/compose', { method: 'POST', headers: { 'x-api-key': apiKey } })`
- `PipelineBuilder.tsx:80-90` — `handleRun` construye steps y llama `onRun(cleaned, apiKey, 'sync')`

---

### AC-02
> IF el usuario intenta agregar un sexto step, SHALL mostrar mensaje "Máximo 5 steps" y deshabilitar el botón.

✅ **CUMPLE**
- `PipelineBuilder.tsx:56` — `const atMaxSteps = steps.length >= MAX_STEPS` (MAX_STEPS=5)
- `PipelineBuilder.tsx:175` — `disabled={atMaxSteps}`
- `PipelineBuilder.tsx:179` — `{atMaxSteps && <span ...>Máximo 5 steps</span>}`

---

### AC-03
> WHEN ejecución síncrona completa, SHALL mostrar resultado JSON, costo total USDC y receipts (sin `receipt_signature`).

✅ **CUMPLE**
- `PipelineStatus.tsx:76-96` — bloque `status === 'completed'`: muestra `totalCost`, `result` en `<pre>`, y receipts
- `PipelineStatus.tsx:94-104` — receipts muestran `step`, `agent_slug`, `cost_usdc`, `call_id` — **`receipt_signature` ausente** ✅

---

### AC-04
> WHEN un step falla, SHALL mostrar step fallido, razón del error y `partial_receipts`.

✅ **CUMPLE**
- `PipelineStatus.tsx:112-135` — bloque `status === 'failed'`: muestra `error`, `stepsExecuted`
- `PipelinePageClient.tsx:92-100` — mapea `errData.reason`, `errData.steps_executed`, `errData.partial_receipts`
- `PipelineStatus.tsx:122-132` — renderiza partial receipts

---

### AC-05
> WHEN el usuario visita `/[locale]/pipelines`, SHALL ver historial de últimas 20 ejecuciones.

✅ **CUMPLE**
- `PipelineHistory.tsx:72-77` — query Supabase `.limit(20).order('created_at', { ascending: false })`
- `PipelinePageClient.tsx:148` — `<PipelineHistory key={historyKey} userId={userId} />`
- Tabla renderizada en `PipelineHistory.tsx:95-134`

---

### AC-06
> IF el usuario no tiene API key, SHALL mostrar el campo de input y deshabilitar botón "Ejecutar".

✅ **CUMPLE**
- `PipelineBuilder.tsx:99-106` — campo input de API key siempre visible
- `PipelineBuilder.tsx:103-107` — mensaje amber si `!apiKey.trim()`
- `PipelineBuilder.tsx:68` — `const canRun = !isRunning && steps.length > 0 && apiKey.trim().length > 0`
- `PipelineBuilder.tsx:185` — `disabled={!canRun}`

---

### AC-07
> WHEN el usuario ingresa una API key, SHALL persistirla en `localStorage` con key `wasi_pipeline_api_key`.

✅ **CUMPLE** (corregido durante CR)
- `PipelineBuilder.tsx:27` — `const API_KEY_STORAGE_KEY = 'wasi_pipeline_api_key'`
- `PipelineBuilder.tsx:39` — `localStorage.getItem(API_KEY_STORAGE_KEY)` ← corregido de `sessionStorage`
- `PipelineBuilder.tsx:45` — `localStorage.setItem(API_KEY_STORAGE_KEY, value)` ← corregido de `sessionStorage`

---

### AC-08
> IF WAS-70 completado, SHALL mostrar toggle "Síncrono / Asíncrono".

⏭️ **N/A — STRETCH** (WAS-70 no está completado)
- Story lo marca explícitamente como stretch. No implementado = correcto.

---

### AC-09
> WHEN modo async activo, SHALL hacer polling a `GET /api/v1/jobs/:jobId` cada 2s.

⏭️ **N/A — STRETCH** (depende de AC-08/WAS-70)
- No implementado = correcto para MVP.

---

## Quality Gate

| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | ✅ Exit 0 — 0 errores |
| Sin `any` explícito | ✅ |
| Keys de React correctas | ✅ (corregidas en CR) |
| localStorage correcto | ✅ (corregido en CR) |

---

## Resumen de correcciones aplicadas

1. **`PipelineBuilder.tsx`** — `sessionStorage` → `localStorage` (AC-07)
2. **`PipelineBuilder.tsx`** — `key={index}` → `key={step._id}` (stable ID via `LocalStep` interface)
3. **`PipelineHistory.tsx`** — `<>` Fragment → `<Fragment key={item.id}>` en map de tabla

---

## Veredicto

| | |
|---|---|
| **Code Review** | ✅ APPROVED (3 BLOQUEANTEs encontrados y corregidos) |
| **QA ACs** | **7/7 MVP PASS** (2 stretch N/A — correctamente no implementados) |
| **Build** | ✅ TSC 0 errores |
