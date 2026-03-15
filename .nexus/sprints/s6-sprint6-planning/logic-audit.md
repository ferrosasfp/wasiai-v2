# Logic Audit — Sprint 6
> NexusAgil v1.3 · Auditor: subagent · Fecha: 2026-03-14

## Tabla de resultados

| Archivo | Check | Resultado | Detalle |
|---------|-------|-----------|---------|
| `invoke/route.ts` | fire-and-forget | ✅ | `void Promise.resolve(...).then(...).catch(...)` — no bloquea TTFB |
| `invoke/route.ts` | settle log NextResponse | ✅ | `if (settlementOrError instanceof NextResponse)` → log + return antes de castear |
| `invoke/route.ts` | logs x402 (3 puntos) | ✅ | `[x402] probe` (no-payment), `[x402] settle_result` (x2: error y éxito), `[x402] upstream_result` — todos en el path correcto |
| `agents/route.ts` | NaN guard completo | ✅ | Cubre: NaN, -1, 101, "abc" (→ NaN), undefined (null check previo) |
| `agents/route.ts` | min_performance en slim mode | ❌ | slim query NO aplica `minPerformance` — filtro ignorado silenciosamente |
| `agents/route.ts` | min_performance en search mode (q) | ❌ | search-mode RPC tampoco recibe `minPerformance` — filtro ignorado |
| `admin/status` | avaxBalance no duplicado | ✅ | `avaxBalanceRaw` se obtiene una sola vez en Promise.all; `avaxBalance` se deriva post-await |
| `admin/status` | queries en Promise.all | ✅ | `failuresPending`, `failures24h`, `invocations24h` están dentro del mismo `Promise.all` — paralelo ✅ |
| `admin/status` | fallback si tabla no existe | ⚠️ | Si `settlement_failures` no existe, las queries fallan sin `.catch()` y el Promise.all entero rechaza → 500 |
| `migrations/059` | orden tabla → índices | ✅ | `CREATE TABLE IF NOT EXISTS` primero, luego ambos `CREATE INDEX IF NOT EXISTS` |
| `migrations/059` | IF NOT EXISTS en todo | ✅ | Presente en tabla y en ambos índices |
| `migrations/060` | IF NOT EXISTS en todo | ✅ | `ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` |

---

## Findings

| # | Severidad | Archivo | Descripción | Fix sugerido |
|---|-----------|---------|-------------|--------------|
| 1 | 🟡 MEDIUM | `agents/route.ts` | `slim` mode ignora `min_performance`: el guard valida y setea `minPerformance`, pero el branch `if (slim)` retorna antes de aplicarlo al query. Un cliente que pase `slim=true&min_performance=80` recibe resultados sin filtrar. | Añadir `if (minPerformance !== undefined) slimQuery = slimQuery.gte('performance_score', minPerformance)` antes de ejecutar slimQuery. |
| 2 | 🟡 MEDIUM | `agents/route.ts` | `q` (search mode) también ignora `min_performance`: el branch RPC `search_agents` retorna sin pasar el filtro. | Añadir el filtro en el resultado post-RPC (array filter) o añadir `min_performance` como parámetro al RPC `search_agents`. |
| 3 | 🔵 LOW | `invoke/route.ts` | `settlement_failures` insert: `.then()` loga éxito sin verificar `{ error }` del resultado Supabase. Supabase v2 no lanza en error de DB — lo retorna como `{ data: null, error: {...} }`. Si el insert falla (e.g. constraint), el log dice "recorded" cuando en realidad falló. `.catch()` solo captura errores de red. | Cambiar `.then()` a `.then((res) => { if (res.error) { logger.error(...) } else { logger.warn('recorded') } })` |
| 4 | 🔵 LOW | `admin/status` | Las queries a `settlement_failures` no tienen `.catch()` individual dentro del `Promise.all`. Si la tabla aún no existe en un entorno (e.g. preview branch sin migración 059), el `Promise.all` entero falla y el endpoint devuelve 500, rompiendo el panel de admin completo. | Añadir `.catch(() => ({ count: null }))` a las dos queries de `settlement_failures`, o envolver en try/catch con fallback `{ count: 0 }`. |

---

## Detalle por check del checklist

### 1. Lógica correcta
- **invoke/route.ts**: flujo correcto. Probe → 402, payment → settle → upstream → log → fire-and-forget insert.
- **agents/route.ts**: NaN guard es correcto para el path full-query. Defecto en slim/search (ver F1, F2).
- **admin/status**: x402_health usa datos ya calculados (`failuresPending`) — sin duplicación.
- **migrations**: 059 y 060 son idempotentes, orden correcto.

### 2. Fire-and-forget
- `void Promise.resolve(...).then(...).catch(...)` ✅
- No bloquea TTFB — el `await logCall(...)` que precede sí es awaited (intencional: necesita `callId` para el insert).

### 3. NaN guard
- `Number(null)` nunca se evalúa (guard `!== null` previo) → `undefined` cubierto ✅
- `Number("abc")` = NaN → `isNaN(parsed)` → 400 ✅
- `-1` → `parsed < 0` → 400 ✅
- `101` → `parsed > 100` → 400 ✅
- `NaN` (si pasara como string "NaN") → `isNaN(NaN)` → 400 ✅

### 4. Logs x402
- `[x402] probe` en path sin payment ✅
- `[x402] settle_result` en path NextResponse (error) ✅
- `[x402] settle_result` en path SettlementResult (éxito/fallo) ✅
- `[x402] upstream_result` post-upstream ✅
- Ninguno de los logs puede lanzar excepción (todos usan primitivos serializables).

### 5. x402_health
- `avaxBalance` no duplicado: se calcula una sola vez post-`Promise.all` ✅
- Sin fallback individual por tabla (ver F4).

### 6. Migración 059
- Orden: tabla → índice parcial (pending) → índice tx_hash ✅
- IF NOT EXISTS en los 3 statements ✅

### 7. admin/status — queries paralelas
- `failuresPending`, `failures24h`, `invocations24h` todos en el array del mismo `Promise.all` ✅

### 8. Settle log + NextResponse
- Checked antes del cast con `instanceof NextResponse` ✅
- Log `settle_result` emitido en ambos branches ✅

---

## Veredicto: PASS ⚠️

El sprint pasa con observaciones. Los 4 cambios core funcionan correctamente.
Findings F1 y F2 son bugs funcionales (filtro silenciosamente ignorado en slim/search mode) que deben corregirse antes de que `min_performance` sea documentado como feature estable.
F3 y F4 son mejoras defensivas de baja prioridad.

**Bloqueantes para release:** Ninguno.  
**Recomendados antes de documentar `min_performance`:** F1, F2.
