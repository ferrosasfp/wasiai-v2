# SDD — HU-1.4: Creator Analytics

> **Estado:** SPEC_APPROVED ✅
> **Fecha:** 2026-02-25
> **HU origen:** `.nexus/docs/prd/HU-1.4-creator-analytics.md`
> **Linear:** WAS-8 · **Sprint:** 2

---

## Objetivo
Agregar una sección de analytics en el dashboard del creator con métricas reales (calls, earnings, latencia, uptime), gráfica de calls/día y alertas automáticas de salud del agente.

---

## Rutas / Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/creator/analytics` | ✅ | Retorna métricas + serie temporal |

**Query params:** `?agent_id=<uuid>` (opcional — si omitido, agrega todos los agentes del creator)

**Response:**
```typescript
{
  summary: {
    totalCalls: number           // all-time
    calls24h: number             // últimas 24h
    avgLatencyMs: number         // promedio últimas 100 calls
    errorRate: number            // 0–1, últimas 100 calls
    uptime24h: number            // 0–1, últimas 24h
    pendingEarningsUsdc: string  // desde creator_profiles
    onchainEarningsUsdc: string  // desde contrato (si wallet configurada)
  }
  dailySeries: Array<{
    date: string                 // YYYY-MM-DD
    calls: number
  }>                             // últimos 30 días
  alerts: Array<{
    type: 'high_error_rate' | 'no_activity'
    agentId: string
    agentName: string
    message: string
  }>
}
```

---

## Schema DB
Sin cambios en schema. Queries sobre tablas existentes:
- `agent_calls`: `agent_id`, `called_at`, `status_code`, `duration_ms`
- `agents`: `id`, `name`, `creator_id`, `status`
- `creator_profiles`: `pending_earnings_usdc`, `wallet_address`

---

## Implementación — Backend

### `src/app/api/creator/analytics/route.ts` — NUEVO

```
GET handler:
1. Auth required → 401
2. Obtener creator_profile del usuario autenticado
3. Obtener agent_ids del creator: SELECT id, name FROM agents WHERE creator_id = profile.id AND status = 'active'
4. Si agent_id param: validar que pertenece al creator → 403 si no
5. Filtrar agent_ids según param (todos o uno)

Queries (todas con agentIds array):

A. Summary — una query:
SELECT
  COUNT(*)                                                           AS total_calls,
  COUNT(*) FILTER (WHERE called_at > NOW() - INTERVAL '24 hours')   AS calls_24h,
  AVG(duration_ms) FILTER (WHERE id IN (
    SELECT id FROM agent_calls WHERE agent_id = ANY($1)
    ORDER BY called_at DESC LIMIT 100
  ))                                                                 AS avg_latency,
  COUNT(*) FILTER (WHERE status_code >= 400
    AND called_at > NOW() - INTERVAL '24 hours')::float /
  NULLIF(COUNT(*) FILTER (WHERE called_at > NOW() - INTERVAL '24 hours'), 0) AS error_rate_24h,
  COUNT(*) FILTER (WHERE status_code < 400
    AND called_at > NOW() - INTERVAL '24 hours')::float /
  NULLIF(COUNT(*) FILTER (WHERE called_at > NOW() - INTERVAL '24 hours'), 0) AS uptime_24h
FROM agent_calls
WHERE agent_id = ANY($1)

B. Daily series (últimos 30 días):
SELECT
  date_trunc('day', called_at AT TIME ZONE 'UTC')::date AS date,
  COUNT(*) AS calls
FROM agent_calls
WHERE agent_id = ANY($1)
  AND called_at > NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1

C. Alerts:
  — error_rate por agente (últimas 24h): si > 0.20 → alert 'high_error_rate'
  — última call por agente: si > 7 días → alert 'no_activity'

D. Earnings on-chain (solo si wallet_address existe):
  — viem: contract.read.earnings([wallet_address])
  — formatUnits(result, 6) → USDC string

6. Merge diario series: rellenar días sin calls con { date, calls: 0 }
7. Return JSON completo
```

**ISR:** Usar Route Handler con `export const revalidate = 300` (5 min).

**Upstash rate limit:** 20 req/min por user_id (analytics puede llamarse con frecuencia).

---

## Implementación — Frontend

### `src/app/[locale]/creator/dashboard/page.tsx` — MODIFICAR
- Agregar import y render de `<CreatorAnalytics agentId={selectedAgentId} />`
- Pasar lista de agentes del creator para el dropdown de selección

### `src/features/creator/components/CreatorAnalytics.tsx` — NUEVO

**Estructura:**
```
<CreatorAnalytics>
  ├── <AgentSelector />         — dropdown si creator tiene 2+ agentes
  ├── <SummaryCards />          — 5 cards: calls 24h, total calls, latencia, uptime, earnings
  ├── <CallsChart />            — gráfica de barras llamadas/día (30 días)
  ├── <AlertBanner />           — alertas de high_error_rate y no_activity
  └── <EmptyState />            — si no hay datos
```

**`SummaryCards`** — 5 cards en grid 2-col mobile / 5-col desktop:
| Card | Valor | Color |
|------|-------|-------|
| Calls (24h) | `summary.calls24h` | neutral |
| Total Calls | `summary.totalCalls` | neutral |
| Latencia avg | `{avgLatencyMs}ms` | verde si <500, amarillo si <2000, rojo si >2000 |
| Uptime (24h) | `{uptime24h*100}%` | verde si >95%, amarillo si >80%, rojo si <80% |
| Earnings | `{pendingUsdc + onchainUsdc} USDC` | Avalanche red |

**`CallsChart`** — barras CSS (sin librería externa):
```typescript
// Implementar con divs — evitar recharts para no añadir dependencia
// Barra = div con height proporcional al max del período
// Tooltip básico al hover con fecha y count
// Si todos los valores son 0 → mostrar empty state inline
```

**`AlertBanner`:**
- `high_error_rate`: fondo rojo claro, ícono ⚠️, texto del SDD
- `no_activity`: fondo amarillo claro, ícono 💤
- Dismissible (state local, no persiste)

**`EmptyState`** — cuando `summary.totalCalls === 0`:
```
"Aún no hay llamadas a este agente.
 Comparte el link de tu agente o intégralo via API."
 [Copiar link] [Ver documentación]
```

**Fetch:** `useSWR` con key `/api/creator/analytics?agent_id=${agentId}` y `refreshInterval: 300_000` (5 min).
No necesita librería extra si `swr` ya está instalada; si no, usar `useEffect` + `fetch` simple.

---

## Verificación de dependencias

```bash
# Verificar si swr está instalada
grep '"swr"' package.json
# Si no → usar useEffect/fetch, no añadir dependencias nuevas
```

---

## i18n

Agregar a `en.json` y `es.json`:
```json
{
  "analytics": {
    "title": "Analytics",
    "calls_24h": "Llamadas (24h)",
    "total_calls": "Total de llamadas",
    "avg_latency": "Latencia promedio",
    "uptime": "Uptime (24h)",
    "earnings": "Earnings",
    "chart_title": "Llamadas por día",
    "alert_error_rate": "Alta tasa de error en {agent}. Revisa tu endpoint.",
    "alert_no_activity": "{agent} sin actividad en 7 días. ¿Está activo?",
    "empty_state": "Aún no hay llamadas. Comparte tu agente o intégralo via API.",
    "all_agents": "Todos los agentes"
  }
}
```

---

## Edge Cases

| Caso | Comportamiento |
|------|----------------|
| Sin agentes activos | Empty state: "Publica tu primer agente" |
| Sin llamadas (agente nuevo) | 5 cards en 0, gráfica vacía, empty state texto |
| Wallet no configurada | `onchainEarningsUsdc` = null → solo mostrar `pendingEarningsUsdc` |
| Error on-chain read | Ignorar silenciosamente → mostrar solo pending earnings con nota "(on-chain no disponible)" |
| Un solo agente | No mostrar dropdown de selección |
| error_rate = null (sin calls 24h) | Mostrar "—" en vez de 0% para no confundir |

---

## Definition of Done

- [ ] `GET /api/creator/analytics` con queries reales sobre `agent_calls`
- [ ] Earnings on-chain si wallet configurada
- [ ] Daily series rellena con ceros los días sin calls
- [ ] Alertas `high_error_rate` y `no_activity` generadas
- [ ] `SummaryCards` con 5 métricas y color semántico
- [ ] `CallsChart` con barras CSS (sin librería)
- [ ] `AlertBanner` dismissible
- [ ] `EmptyState` útil
- [ ] Dropdown de agente si creator tiene 2+
- [ ] i18n en/es
- [ ] `npm run build` limpio
- [ ] Adversarial review (foco: auth bypass en query, correctness de métricas)
- [ ] AC1–AC7 verificados

---

*SPEC_APPROVED — Sprint 2, 2026-02-25*
