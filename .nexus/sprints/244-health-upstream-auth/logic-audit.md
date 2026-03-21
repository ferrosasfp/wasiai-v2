## Logic Audit — WAS-244 (commit `9d724c6`)

**Auditor:** Logic Auditor (subagent)  
**Date:** 2026-03-19  
**File:** `src/app/api/v1/agents/[slug]/health/route.ts`

---

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|--------------|---------------|--------|
| AC-01: Probe incluye `Authorization: Bearer {webhook_secret}` si no es null | ✅ | route.ts:53-54 | PASS |
| AC-02: HTTP 200 upstream → status: "healthy" | ✅ | route.ts:62 | PASS |
| AC-03: HTTP 4xx/5xx upstream (incluyendo 401) → status: "unhealthy" | ✅ | route.ts:62 | PASS |
| AC-04: webhook_secret null/empty → probe sin auth header (graceful) | ✅ | route.ts:53-54 | PASS |
| AC-05: webhook_secret NO aparece en API response | ✅ | route.ts:60-65 | PASS |
| AC-06: Shape del response se preserva | ✅ | route.ts:60-65 | PASS |

---

### Corrección Lógica

#### ✅ Fix principal aplicado correctamente
**Línea 62:** `status: probe.ok ? 'healthy' : 'unhealthy'`

- **ANTES (buggy):** `probe.ok || probe.status < 500` → 401 se evaluaba como `healthy` 
- **AHORA (correcto):** Solo `probe.ok` → 401 (y cualquier 4xx/5xx) se evalúa como `unhealthy`
- `probe.ok` es `true` solo para status codes 200-299 (según spec de Fetch API)

#### ✅ Conditional headers correcto
**Líneas 53-54:**
```typescript
...(model.webhook_secret ? { 'Authorization': `Bearer ${model.webhook_secret}` } : {})
```

- Spread operator con condicional funciona correctamente
- Si `webhook_secret` es truthy → header agregado
- Si `webhook_secret` es falsy (null/undefined/"") → objeto vacío, sin header

#### ✅ No hay filtración de secretos
**Líneas 60-65:** Response solo incluye:
- `slug`, `name`, `status`, `latency_ms`, `upstream_status`
- `webhook_secret` NO está presente

---

### Edge Cases

| Caso | Comportamiento actual | Status |
|------|----------------------|--------|
| `webhook_secret = ""` (string vacío) | Falsy → sin header Authorization | ✅ CORRECTO |
| `webhook_secret = null` | Falsy → sin header Authorization | ✅ CORRECTO |
| `webhook_secret = undefined` | Falsy → sin header Authorization | ✅ CORRECTO |
| Upstream devuelve 401 | `probe.ok = false` → `unhealthy` | ✅ CORRECTO (era el bug) |
| Upstream devuelve 404 | `probe.ok = false` → `unhealthy` | ✅ CORRECTO |
| Upstream devuelve 500 | `probe.ok = false` → `unhealthy` | ✅ CORRECTO |
| Upstream devuelve 200 | `probe.ok = true` → `healthy` | ✅ CORRECTO |
| Timeout (5s) | Catch → `unhealthy` con reason "unreachable" | ✅ CORRECTO |

---

### Error Handling

**Try-catch (líneas 51-78):** Funcionando correctamente
- Fetch exitoso → evalúa `probe.ok` y retorna status
- Fetch falla (timeout, red, CORS) → catch retorna 503 con `status: "unhealthy"`

---

### Findings

| # | Severidad | Detalle | Archivo:línea |
|---|-----------|---------|---------------|
| _No hay findings_ | — | Implementación correcta, todos los AC cumplidos | — |

---

### Veredicto

✅ **APROBADO**

**Resumen:**
- El commit corrige correctamente el bug de lógica reportado
- Todos los acceptance criteria están implementados
- No se detectaron bugs lógicos
- El manejo de edge cases es robusto
- No hay riesgo de filtración de secretos
- Error handling preservado

**Cambio clave:**
```diff
- status:  probe.ok || probe.status < 500 ? 'healthy' : 'unhealthy',
+ status:  probe.ok ? 'healthy' : 'unhealthy',
```

Este cambio resuelve el problema original donde HTTP 401 (y otros 4xx) se marcaban incorrectamente como `healthy`.
