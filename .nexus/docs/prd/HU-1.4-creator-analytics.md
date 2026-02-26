# HU-1.4 — Creator Analytics

> **Estado:** HU_APPROVED ✅
> **Linear:** WAS-8
> **Sprint:** 2 (25 Feb – 28 Feb 2026)
> **Épica:** 1 — Creators Reales

---

## Historia de Usuario

Como **creator** que tiene uno o más agentes publicados,
quiero ver métricas reales de mis agentes (calls, earnings, latencia, alertas),
para saber si mi agente está funcionando, cuánto gano y si hay algo que mejorar.

---

## Criterios de Aceptación

- [ ] **AC1:** En `/creator/dashboard`, existe una sección "Analytics" que muestra, por agente:
  - Total de llamadas (all-time y últimas 24h)
  - Earnings acumuladas on-chain (en USDC)
  - Latencia promedio de las últimas 100 llamadas (en ms)
  - Tasa de error (% de llamadas con status ≠ 200, últimas 100)
  - Uptime estimado: % de calls exitosas de las últimas 24h

- [ ] **AC2:** Existe una gráfica de "llamadas por día" de los últimos 30 días, por agente.
  - Si el creator tiene múltiples agentes, puede seleccionar cuál ver con un dropdown
  - La gráfica usa datos reales de la tabla `agent_calls`

- [ ] **AC3:** Si un agente tiene tasa de error > 20% en las últimas 24h, el dashboard muestra una alerta visual: "Tu agente [nombre] tiene alta tasa de error. Revisa tu endpoint."

- [ ] **AC4:** Si un agente no ha recibido llamadas en 7 días, muestra un notice: "Sin actividad reciente. ¿Tu agente está activo?"

- [ ] **AC5:** Los datos se cargan server-side (Server Component o Route Handler con ISR de 5 min) — no hay polling en el cliente.

- [ ] **AC6:** Si no hay datos aún (agente recién publicado), se muestra un empty state útil: "Aún no hay llamadas. Comparte tu agente o intégralo en tu app."

- [ ] **AC7:** Toda la sección es responsive — funciona en mobile.

---

## Scope

### In scope
- Métricas de `agent_calls`: total, latencia, errores
- Earnings de `creator_profiles.pending_earnings_usdc` + on-chain via viem
- Gráfica de calls/día (últimos 30 días)
- Alertas automáticas: alta tasa de error, sin actividad
- Empty states útiles
- Datos reales de Supabase — cero datos simulados

### Out of scope
- Exportar CSV
- Métricas históricas más allá de 30 días
- Comparar agentes entre sí en la misma gráfica
- Notificaciones push/email (eso es HU-8.3)
- Revenue projection / forecasting

---

## Diseño / UX

- La sección Analytics reemplaza o amplía la tabla "Últimas llamadas" existente
- Cards de resumen arriba (totales) + gráfica abajo + tabla de últimas llamadas
- Alerta de error en rojo / notice de inactividad en amarillo — no bloqueantes
- Dropdown de selección de agente solo aparece si el creator tiene 2+ agentes

---

## Datos disponibles en DB

- `agent_calls`: `agent_id`, `called_at`, `status_code`, `duration_ms`, `payer_address`
- `agents`: `slug`, `name`, `status`, `creator_id`
- `creator_profiles`: `pending_earnings_usdc`, `wallet_address`
- Earnings on-chain: `CONTRACT.earnings(wallet_address)` via viem

---

## Notas técnicas

- Para la gráfica: usar una librería ligera como `recharts` (ya en golden path) o simplemente SVG/CSS bars si no está instalada — priorizar velocidad de entrega
- La consulta de calls/día puede hacerse con `date_trunc('day', called_at)` en Supabase
- Earnings on-chain: llamada de solo lectura, no consume gas
- Si `wallet_address` es null, mostrar solo `pending_earnings_usdc` sin llamada on-chain
