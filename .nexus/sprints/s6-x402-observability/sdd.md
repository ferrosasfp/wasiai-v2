# SDD #S6-02: Observabilidad x402 — Métricas + Alertas

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: feature
> SDD_MODE: full
> Branch: feat/s6-02-x402-observability

---

## 1. Resumen

No hay métricas estructuradas del pipeline de pagos x402. Un fallo silencioso (settlement ok → upstream falla) solo aparece en logs de Vercel dispersos. Este SDD añade métricas clave en `invoke/route.ts` y un endpoint de alertas en `/api/admin/status` que permita detectar problemas operacionales en segundos, no horas.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | S6-02 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Métricas estructuradas en invoke + alertas críticas en admin/status |
| **Reglas de negocio** | Métricas no bloquean TTFB. Alertas son queries a Supabase, no cálculos en tiempo real. |
| **Scope IN** | Logs estructurados en invoke/route.ts, sección `x402_health` en `/api/admin/status` |
| **Scope OUT** | Dashboard UI, Grafana, Datadog, webhooks de alerta, métricas de agent key path |
| **Missing Inputs** | N/A |

### Acceptance Criteria (EARS)

1. WHEN a 402 probe occurs (no X-PAYMENT header), THE system SHALL log `[x402] probe` with `{ slug, ip }`.
2. WHEN `settlePaymentDirectly` resolves, THE system SHALL log `[x402] settle_result` with `{ slug, verified, settled, latency_ms, error? }`.
3. WHEN upstream resolves after settlement, THE system SHALL log `[x402] upstream_result` with `{ slug, status, latency_ms }`.
4. WHEN `GET /api/admin/status` is called, THE response SHALL include `x402_health` with `{ settlement_failures_24h, upstream_failures_post_settle_24h, operator_avax_balance, total_invocations_24h }`.
5. IF `settlement_failures_pending > 0`, THEN `x402_health.alert` SHALL be `"CRITICAL: N settlement failures pending"`.
6. IF `operator_avax_balance < 0.2`, THEN `x402_health.alert` SHALL be `"WARNING: low operator AVAX"`.

## 3. Context Map

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Dónde añadir logs | `logger.info/error` ya existe, seguir mismo patrón |
| `src/app/api/admin/status/route.ts` | Dónde añadir x402_health | Ver estructura actual de respuesta |
| `src/lib/logger.ts` | Patrón de logging | `logger.info(msg, payload)` |
| `src/lib/contracts/usdcSettler.ts` | Dónde medir latencia de settle | Función `settlePaymentDirectly` retorna `SettlementResult` |

### Exemplars

| Para modificar | Seguir patrón de | Razón |
|---------------|------------------|-------|
| Logs en invoke/route.ts | `logger.info('[settler] USDC transfer confirmed', { txHash })` | Mismo formato |
| x402_health en admin/status | Consultas existentes en admin/status | Patrón de query Supabase |

### Estado de BD

| Tabla | Existe | Relevante para |
|-------|--------|----------------|
| `agent_calls` | Sí | Contar `status='error'` en 24h post-settlement |
| `settlement_failures` | Sí (S6-01) | Contar pending + 24h failures |

### Componentes reutilizables

- `logger` de `src/lib/logger.ts`
- `createPublicClient` de viem (para leer AVAX balance del operator)
- RPC mainnet ya configurado en `usdcSettler.ts`

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|----------|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificar | Añadir 3 logs estructurados | `logger.info` existentes |
| `src/app/api/admin/status/route.ts` | Modificar | Añadir sección `x402_health` | consultas existentes |

### 4.2 Logs a añadir en invoke/route.ts

**Probe (sin X-PAYMENT):**
```typescript
// Justo antes de return 402
logger.info('[x402] probe', { slug, ip: getIdentifier(request) })
```

**Settle result:**
```typescript
// Justo después de settleX402()
const settleStart = Date.now()
// ...settle...
logger.info('[x402] settle_result', {
  slug,
  verified: settlement.verified,
  settled: settlement.settled,
  latency_ms: Date.now() - settleStart,
  error: settlement.error ?? null,
})
```

**Upstream result:**
```typescript
// Justo después de callUpstream()
logger.info('[x402] upstream_result', {
  slug,
  status: result.status,
  latency_ms: result.latencyMs,
  charged: result.status === 'success',
})
```

### 4.3 Sección x402_health en admin/status

```typescript
// Queries paralelas (Promise.all) — AVAX balance ya existe en respuesta raíz como avaxBalance
// NO duplicar avaxBalance en x402_health — referenciar el valor ya calculado
const [failuresPending, failures24h, invocations24h] = await Promise.all([
  supabase.from('settlement_failures').select('id', { count: 'exact', head: true }).is('resolved_at', null),
  supabase.from('settlement_failures').select('id', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - 86400000).toISOString()),
  supabase.from('agent_calls').select('id', { count: 'exact', head: true })
    .eq('payment_type', 'x402')
    .gte('called_at', new Date(Date.now() - 86400000).toISOString()),
])

// avaxBalance ya calculado en la respuesta raíz (avaxBalance de línea ~50) — reutilizar
// Alert logic — usar avaxBalance existente del scope
let alert: string | null = null
if ((failuresPending.count ?? 0) > 0) alert = `CRITICAL: ${failuresPending.count} settlement failures pending`
else if (avaxBalance < 0.2) alert = `WARNING: low operator AVAX (${avaxBalance.toFixed(3)})`

// x402_health NO incluye operator_avax_balance — ya está en raíz como avaxBalance
return { x402_health: { settlement_failures_pending: failuresPending.count ?? 0, settlement_failures_24h: failures24h.count ?? 0, total_invocations_24h: invocations24h.count ?? 0, alert } }
```

### 4.4 Flujo principal

1. Request llega sin X-PAYMENT → log probe → return 402
2. Request llega con X-PAYMENT → settle (medir latencia) → log settle_result
3. Upstream se llama → log upstream_result
4. `/api/admin/status` → queries paralelas → x402_health con alertas

### 4.5 Flujo de error

- Si la query de Supabase para admin/status falla: `x402_health: { error: 'unavailable' }` — nunca 500

## 5. Constraint Directives

### OBLIGATORIO seguir
- Logs: `logger.info('[x402] <evento>', { payload })` — mismo formato que logs existentes
- AVAX balance: medir en `Number(balance) / 1e18`
- Queries admin/status en `Promise.all` para no serializar
- `payment_type` field existe en `agent_calls` — filtrar por `'x402'` para invocaciones Route B

### PROHIBIDO
- NO añadir latencia al path crítico (logs son síncronos pero baratos)
- NO lanzar excepciones desde la sección x402_health — siempre degradar gracefully
- NO crear nuevo endpoint — ir a `/api/admin/status` existente
- NO modificar `usdcSettler.ts` — solo medir tiempo en invoke/route.ts
- NO añadir dependencias externas (Datadog, Sentry, etc.)

## 6. Scope

**IN:**
- 3 logs estructurados en invoke/route.ts (probe, settle_result, upstream_result)
- Sección `x402_health` en `/api/admin/status`
- AVAX balance check del operator wallet

**OUT:**
- Dashboard UI
- Alertas push (email, Slack, webhook)
- Métricas de Route A (agent key)
- Histograma de latencias (solo punto en tiempo)

## 7. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| RPC call para AVAX balance añade latencia a admin/status | M | B | Timeout de 3s, fallback a `null` |
| `payment_type` no está seteado en todas las filas | M | B | Filtro opcional, no falla si count=0 |

## 8. Dependencias

- S6-01 (settlement_failures table) — necesaria para las queries de x402_health

---

*SDD generado por NexusAgil — FULL | Sprint 6*
