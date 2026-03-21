# Logic Audit — WAS-245 v2

**Commit:** `a9f91c1eb8e9fbab80e0cab7c3f28330a1ee677e`  
**Archivo auditado:** `src/app/api/v1/agents/[slug]/reputation/route.ts`  
**Auditor:** Subagent Logic Auditor  
**Fecha:** 2026-03-19 19:02 CST

---

## AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|---------|
| AC-01: Agente con last_call hace 3 días → `is_available: true` | ✅ | L159-160 (window), L168-175 (query), L200 (logic) | **PASS** |
| AC-02: Agente con last_call hace 8 días → `is_available: false` | ✅ | L168-175 (query), L200 (logic) | **PASS** |
| AC-03: Cambiar `available_window_days` en DB → efecto sin deploy | ✅ | L153-159 (read from DB on every request, no cache) | **PASS** |
| AC-04: `last_invocation_at` no es null si hay calls | ✅ | L162-167 (query), L207 (output) | **PASS** |
| AC-05: Build sin errores | ⚠️ | (no verificado en runtime) | **PENDING** |

---

## Trazabilidad detallada del flujo de disponibilidad

1. **Lectura de configuración desde DB** (L153-159):
   ```typescript
   const { data: windowSetting } = await serviceClient
     .from('app_settings')
     .select('value')
     .eq('key', 'agent_available_window_days')
     .single()
   const availableWindowDays = parseInt(windowSetting?.value ?? '7', 10)
   const availableWindowMs = availableWindowDays * 24 * 60 * 60 * 1000
   ```
   ✅ Lee `agent_available_window_days` con `serviceClient` (bypass RLS)  
   ✅ Default a `'7'` si no existe el setting  
   🐛 **PROBLEMA**: `parseInt()` puede devolver `NaN` si el valor en DB está malformado

2. **Query de llamadas recientes** (L168-173):
   ```typescript
   const { data: recentCalls } = await serviceClient
     .from('agent_calls')
     .select('status')
     .eq('agent_id', agent.id)
     .gte('called_at', new Date(Date.now() - availableWindowMs).toISOString())
   ```
   ✅ Usa `availableWindowMs` dinámico (NO hardcodeado)  
   ✅ Query filtrado por ventana configurable

3. **Cálculo de señal de actividad reciente** (L175):
   ```typescript
   const hasRecentActivity = (recentCalls ?? []).some(c => c.status === 'success')
   ```
   ✅ Solo cuenta llamadas exitosas

4. **Verificación de health check** (L193-195):
   ```typescript
   const healthCheckPassed = healthCheck?.passed === true &&
     agent.last_checked_at !== null &&
     new Date(agent.last_checked_at as string).getTime() > Date.now() - availableWindowMs
   ```
   ✅ También usa `availableWindowMs` (NO hardcodeado a 24h)

5. **Lógica final de disponibilidad** (L200):
   ```typescript
   const isAvailable = !healthCheckFailed && (healthCheckPassed || hasRecentActivity)
   ```
   ✅ Combina correctamente las señales:
   - Si health check falló explícitamente → `false`
   - Si health check pasó recientemente → `true`
   - Si hay actividad exitosa reciente → `true`
   - En otro caso → `false`

---

## Findings

| # | Severidad | Detalle | Archivo:línea |
|---|-----------|---------|---------------|
| **F-01** | 🔴 **CRITICAL** | `parseInt(windowSetting?.value ?? '7', 10)` retorna `NaN` si el valor en DB es malformado (ej: `"abc"`, `"7.5días"`). Esto rompe silenciosamente todos los cálculos de tiempo. | `route.ts:159` |
| **F-02** | 🟡 **MINOR** | No hay validación de rango: si alguien pone `0` o negativo en DB, `availableWindowMs` sería 0 o negativo, rompiendo la lógica de ventana. | `route.ts:159-160` |
| **F-03** | 🟢 **INFO** | El hardcoded `30 * 24 * 60 * 60 * 1000` (L182) para `callsBreakdown` es correcto — NO debería usar la ventana de disponibilidad configurable. | `route.ts:182` |
| **F-04** | 🟢 **INFO** | El hardcoded `14 * 24 * 60 * 60 * 1000` (L90) para `calcTrend` es correcto — trend usa ventanas fijas de 7d/14d por diseño. | `route.ts:90, 95, 99` |

---

## Recomendación de fix

**Para F-01 y F-02**, reemplazar L159:

```typescript
// ❌ ACTUAL (frágil)
const availableWindowDays = parseInt(windowSetting?.value ?? '7', 10)

// ✅ PROPUESTO (robusto)
const availableWindowDays = Math.max(1, parseInt(windowSetting?.value ?? '7', 10) || 7)
```

**Garantías:**
- Si `parseInt()` falla → `NaN || 7` → `7` (default seguro)
- Si alguien pone `0` o negativo → `Math.max(1, ...)` → mínimo 1 día
- Valores válidos (1-365) → se respetan tal cual

---

## Scope creep check

✅ **NO hay scope creep**:
- Solo se modificó el endpoint `/api/v1/agents/[slug]/reputation`
- No se tocaron otros endpoints
- `callsBreakdown` (30 días) permanece sin cambios
- `calcTrend` (7d/14d) permanece sin cambios
- La única referencia a la ventana de disponibilidad está correctamente aislada en:
  - Query de `recentCalls` (L168-173)
  - Validación de `healthCheckPassed` (L193-195)

---

## Veredicto

### ⚠️ **REQUIERE CORRECCIÓN**

**El código implementa correctamente la lógica de WAS-245**, pero tiene una vulnerabilidad crítica:

- **F-01 (CRITICAL)**: Falta validación de `parseInt()` → puede causar failure silencioso si el valor en DB está corrupto
- **F-02 (MINOR)**: Falta validación de rango → valores `<= 0` rompen la lógica de ventana

**Impacto si se despliega sin fix:**
- Si un admin accidentalmente guarda `"7 days"` (string con unidad) en vez de `"7"` → `availableWindowMs = NaN` → todos los agentes aparecerían como no disponibles
- Si guarda `"0"` → ventana de 0ms → solo agentes con calls en el último milisegundo serían disponibles

**Acción requerida:**
1. Aplicar el fix propuesto (validación con `Math.max(1, ... || 7)`)
2. Re-auditar commit con fix aplicado
3. Agregar test de integración que verifique comportamiento con valores malformados en DB

---

**Auditoría completada.** Código funcional pero frágil. Fix es trivial (1 línea). Recomendar aplicar antes de merge a `main`.
