# Logic Audit — WAS-207 / POST /introspect
> Auditor: NexusAgil v1.3 — Logic Auditor
> Commit: `079731c46`
> Fecha: 2026-03-15
> **Veredicto: REQUIERE CORRECCIÓN**

---

## 1. Trazabilidad AC → Código

| AC | Descripción | Implementado en | Estado |
|----|-------------|-----------------|--------|
| AC1 | Request válido → 200 con COB firmado | `route.ts` líneas ~230-260 (path A) y ~290-320 (path B) | ✅ |
| AC2 | Pricing por depth: $0.10/$0.25/$0.50 | `INTROSPECT_PRICE` map en `route.ts` + `buildRequirements()` | ✅ |
| AC3 | Sin payment → 402 con precio correcto | `build402Response()` usa `INTROSPECT_PRICE[depth]` | ✅ |
| AC4 | `operator_signature` = keccak256 firmado por operator wallet | `signCOB()` en `buildCOB.ts` | ✅ |
| AC5 | shallow/mid → `memory_diffs` incremental | `assembleCOB()` filtra por 'delta'/'diff' keys | ⚠️ Ver BUG-03 |
| AC6 | Timeout → COB parcial con `truncated: true` | `callUpstreamIntrospect()` detecta AbortError/TimeoutError | 🔴 Ver BUG-01 |
| AC7 | Agent key con budget suficiente → sin 402 | Chequeo `remaining < price` en path A | 🔴 Ver BUG-02 |

---

## 2. Bugs Encontrados

### 🔴 BUG-01 — `truncated: true` se activa en CUALQUIER error upstream, no solo timeout
**Severidad:** CRÍTICO  
**Archivo:** `route.ts` ~línea 234 y ~línea 288  
**Código ofensivo:**
```typescript
truncated: upstream.timedOut || upstream.status === 'error',
truncatedReason: upstream.timedOut ? 'timeout' : upstream.status === 'error' ? 'upstream_error' : undefined,
```
**Problema:**  
El AC6 dice que `truncated: true` aplica solo cuando la llamada excede `timeout_ms`. La nota de riesgos del SDD (§6) explícitamente establece que cuando el upstream retorna error (no timeout), el COB debe tener `truncated: false` (COB vacío válido).  
Con la lógica actual, si el upstream devuelve un HTTP 500, `truncated=true` — incorrecto.

**Fix:**
```typescript
truncated: upstream.timedOut,
truncatedReason: upstream.timedOut ? 'timeout' : undefined,
```
Para el caso `status === 'error'` sin timeout, el COB debe ser válido con arrays vacíos y `truncated: false`.

---

### 🔴 BUG-02 — Race condition en budget deduction (path A: agent key)
**Severidad:** CRÍTICO  
**Archivo:** `route.ts` ~línea 216-230  
**Código ofensivo:**
```typescript
// CHECK (application layer — non-atomic)
const remaining = Number(keyRow.budget_usdc) - Number(keyRow.spent_usdc)
if (remaining < price) { return 402 }

// ... llamada upstream ...

// DEDUCT (fire-and-forget, después del check)
void Promise.resolve(
  supabase.rpc('check_and_deduct_budget', { p_key_id: keyRow.id, p_amount: price })
).catch(...)
```
**Problema:**  
El check `remaining < price` es en memoria y no es atómico con la deducción. Dos requests concurrentes con el mismo agent key pueden:
1. Ambas leer `remaining = $0.15` (budget real)
2. Ambas pasar el check para una operación de $0.10
3. Ambas llaman upstream y gastan $0.20 total, excediendo el budget

Además, la deducción es `fire-and-forget` — si falla silenciosamente, el budget nunca se descuenta.

**Fix:**
- Mover el `check_and_deduct_budget` RPC ANTES de la llamada upstream (atómico en DB).
- Eliminar el check previo en application layer, dejarlo 100% en el RPC con return de éxito/fracaso.
- Awaitar la deducción o al menos loggear el error con mayor visibilidad.

---

### ⚠️ BUG-03 — Filtro de `memory_diffs` demasiado restrictivo (AC5)
**Severidad:** MODERADO  
**Archivo:** `buildCOB.ts` ~línea 52-58  
**Código ofensivo:**
```typescript
memoryDiffs = raw
  .filter((e) => typeof e === 'object' && e !== null && ('delta' in e || 'diff' in e))
  .slice(0, opts.depth === 'mid' ? 20 : 10)
```
**Problema:**  
Si el upstream retorna `memory_diffs` válidos pero sin keys 'delta' ni 'diff' (e.g., `{ before: X, after: Y }`), el resultado será un array vacío. El SDD dice "incremental (not full blob)" pero no define que los entries deban tener esas keys específicas. Este filtro puede producir silenciosamente un COB vacío de memory_diffs cuando hay datos válidos.

**Fix sugerido:**  
Para shallow/mid, limitar por cantidad/tamaño en lugar de filtrar por keys:
```typescript
memoryDiffs = raw.slice(0, opts.depth === 'mid' ? 20 : 10)
```
Si se necesita garantizar "incremental" semánticamente, documentar el contrato con el upstream en el SDD.

---

### ⚠️ BUG-04 — `logCall` se awaita ANTES de que el budget se deduzca
**Severidad:** MENOR  
**Archivo:** `route.ts` path A  
**Problema:**  
El log se registra como exitoso (`status: upstream.status`) antes de confirmar que el budget fue deducido. Si la deducción falla (fire-and-forget), el sistema registra una llamada procesada pero el budget no refleja el gasto. No es un bug de lógica de respuesta pero sí de consistencia de datos.

---

### ⚠️ BUG-05 — Sin validación de longitud en `runtime` y `target`
**Severidad:** MENOR  
**Archivo:** `route.ts` ~línea 240-246  
**Problema:**  
Solo se valida que `runtime` y `target` sean truthy, sin límite de longitud. Un caller puede enviar strings de varios MB que se reenvían al upstream y se incluyen en el JSON del COB que se firma. Potencial DoS / spike de latencia.

**Fix:**
```typescript
if (!body.runtime || !body.target || body.runtime.length > 200 || body.target.length > 500) { ... }
```

---

## 3. Checklist Completo

| # | Check | Resultado |
|---|-------|-----------|
| 1 | Trazabilidad AC → Código | AC1-AC4 ✅, AC5 ⚠️, AC6 🔴, AC7 🔴 (race) |
| 2 | Corrección lógica (comparaciones, operadores, defaults) | `timeout_ms` default 5000 ✅, `Math.min(..., 30_000)` ✅, pricing correcto ✅ |
| 3 | Edge cases | `upstreamData` null/non-object → `{}` ✅, depth inválido → 400 ✅, JSON parse error → 400 ✅ |
| 4 | Concurrencia | Race condition en budget check/deduct 🔴 |
| 5 | Error handling | Firma falla → null (no-fatal) ✅ per SDD, upstream unreachable → manejado ✅ |
| 6 | Tipos y casting | `Number(keyRow.budget_usdc)` puede ser NaN si el campo es null — riesgo bajo pero real ⚠️ |
| 7 | Side effects no documentados | `endpoint_url` NO expuesto en COB ✅, no storage persistente ✅, `__introspect: true` se añade al body upstream — no documentado pero razonable |

---

## 4. Observaciones Adicionales

- **Firma (AC4):** La implementación hace `signMessage({ raw: toBytes(keccak256(json)) })` — esto es `personal_sign` estándar sobre el hash del COB. Es verificable y sigue el patrón de `signReceipt.ts`. Correcto.
- **SSRF protection:** `validateEndpointUrl` está presente ✅. El SDD no lo menciona explícitamente pero es buena práctica.
- **CONTRACT_ADDRESS vacío:** Si `MARKETPLACE_CONTRACT_ADDRESS` no está configurado, `payTo` en el 402 será string vacío. No bloquea pero el cliente no sabrá a dónde pagar.
- **`erc8004_identity` vacío:** Si el agente no tiene `on_chain_registered` o `creator_wallet`, se pasa `''`. El COB es válido pero con identidad vacía — aceptable per SDD.

---

## 5. Resumen de Correcciones Requeridas

| # | Bug | Severidad | Acción |
|---|-----|-----------|--------|
| BUG-01 | `truncated: true` en cualquier error upstream | 🔴 CRÍTICO | Fix lógica: solo `upstream.timedOut` |
| BUG-02 | Race condition en budget check/deduct | 🔴 CRÍTICO | Mover deducción antes del upstream call, awaitar |
| BUG-03 | Filtro de memory_diffs por keys específicas | ⚠️ MODERADO | Cambiar a slice por cantidad |
| BUG-04 | logCall antes de budget deduct | ⚠️ MENOR | Reordenar o loggear fallo de deducción |
| BUG-05 | Sin límite de longitud en runtime/target | ⚠️ MENOR | Agregar validación de longitud |

---

## Veredicto Final

**🔴 REQUIERE CORRECCIÓN**

Dos bugs críticos impiden aprobar:
1. **BUG-01** viola directamente AC6 y la nota de riesgos del SDD.
2. **BUG-02** viola AC7 en condiciones de concurrencia — un agent key con $0.10 de budget puede ser usado dos veces simultáneamente.

Los demás bugs son menores y no bloquean funcionalmente, pero deben corregirse antes de merge a main.
