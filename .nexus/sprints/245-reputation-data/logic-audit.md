# Logic Audit — WAS-245 (commit `cde0c75`)

**Auditor:** Subagent Logic Auditor  
**Fecha:** 2026-03-19  
**Archivo auditado:** `src/app/api/v1/agents/[slug]/reputation/route.ts`  

---

## AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|--------------|---------------|--------|
| AC-01: `last_invocation_at` devuelve fecha real (serviceClient para agent_calls) | ✅ | route.ts:137-144, 201 | **PASS** |
| AC-02: `is_available: true` cuando hay calls exitosas en 24h aunque health_check sea null | ⚠️ | route.ts:147-149, 172-180 | **FALLA** |
| AC-03: `is_available: false` si health_check.passed === false explícito | ✅ | route.ts:178, 180 | **PASS** |
| AC-04: No se expone data privada de agent_calls en response | ✅ | route.ts:192-209 | **PASS** |
| AC-05: Shape del response se preserva | ✅ | route.ts:192-209 | **PASS** |

---

## Findings

| # | Severidad | Detalle | Archivo:línea |
|---|-----------|---------|---------------|
| **F-01** | **🔴 CRÍTICO** | **AC-02 violado:** `callsBreakdown` filtra por **30 días** (línea 149) pero AC-02 requiere evaluar actividad exitosa en **24 horas**. El cálculo de `hasRecentActivity` (línea 175) cuenta calls exitosas en los últimos 30 días, no 24h. Un agente con 1 call exitosa hace 29 días sería marcado `is_available: true` incorrectamente. | route.ts:147-149, 172-175 |
| **F-02** | 🟡 MENOR | El comentario en línea 147 dice "Breakdown de tipos de invocación últimos 30 días" pero la variable se usa para determinar disponibilidad en 24h (inconsistencia semántica). | route.ts:147 |
| **F-03** | 🟢 INFO | `createServiceClient()` se llama correctamente por request (línea 137) — no hay leak de conexiones. | route.ts:137 |
| **F-04** | 🟢 INFO | Edge case manejado correctamente: si `callsBreakdown` es null, `recentSuccessCount` se inicializa en 0 vía `?.filter()` y `?? 0`. | route.ts:172-175 |

---

## Corrección lógica (checklist)

### ✅ PASS: `callsBreakdown` incluye `status` en select
**Línea 148:** `.select('payment_type, is_trial, status')`  
El campo `status` está presente y se usa correctamente en línea 173.

### ❌ FALLA: Filtro temporal incorrecto para `hasRecentActivity`
**Línea 149:** `.gte('called_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())`  
**Problema:** AC-02 requiere evaluar calls exitosas en **24 horas**, pero el query filtra por **30 días**.  
**Impacto:** Un agente con 1 call exitosa hace 25 días será marcado `is_available: true` cuando debería ser `false` (no tiene actividad reciente en 24h).

**Solución esperada:**
```typescript
// Query dedicado para hasRecentActivity (24h)
const { data: recentCalls } = await supabase
  .from('agent_calls')
  .select('status')
  .eq('agent_id', agent.id)
  .gte('called_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

const recentSuccessCount = recentCalls?.filter(c => c.status === 'success').length ?? 0
const hasRecentActivity = recentSuccessCount > 0
```

### ✅ PASS: `healthCheckFailed` solo `true` cuando `passed === false`
**Línea 178:** `const healthCheckFailed = healthCheck?.passed === false`  
Strict equality — no confunde `null` con `false`.

### ✅ PASS: `createServiceClient` se llama por request
**Línea 137:** Dentro del handler `GET()` — no hay singleton global.

### ✅ PASS: `serviceClient` está disponible cuando se usa
Declaración en línea 137, uso en línea 138 — scope correcto.

---

## Edge cases

### ✅ Manejado: `callsBreakdown` null
**Líneas 152-157:** Uso de `?.filter()` y `?? 0` previene NPE.

### ✅ Manejado: Todas las calls son `error`
Si `callsBreakdown` solo tiene calls con `status: 'error'`, `recentSuccessCount = 0` → `hasRecentActivity = false` → comportamiento correcto.

### ✅ Manejado: `serviceClient` falla silenciosamente
Si `lastCall` es `null`, línea 201 retorna `last_invocation_at: null` — fallback aceptable.

---

## Error handling

No se encontraron paths de error sin manejo. Todos los casos críticos usan optional chaining o fallback a `null`.

---

## Veredicto: **⚠️ REQUIERE CORRECCIÓN**

**Razón:** Violación de AC-02 (finding F-01 crítico).  
El filtro temporal de `callsBreakdown` debe cambiarse de 30 días a 24 horas **solo para el cálculo de `hasRecentActivity`**.  

**Recomendación:**  
Mantener el query de 30 días para `paidRatio` y métricas de pago, pero agregar un query separado de 24h para `hasRecentActivity` (ver solución en F-01).

**Aprobación condicionada:** Si el equipo acepta tolerar ventana de 30d para disponibilidad (cambio de AC-02), el código es correcto. De lo contrario, requiere fix.

---

**Siguiente paso:** Escalar finding F-01 al Requirements Reviewer para validar si AC-02 debe ajustarse o el código debe corregirse.
