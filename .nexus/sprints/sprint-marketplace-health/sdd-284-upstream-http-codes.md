# SDD WAS-284 — Upstream errors propagan HTTP status correcto
**Clasificación:** HU-MINOR
**Archivo principal:** `src/app/api/v1/models/[slug]/invoke/route.ts`

## Context
`buildResponse` siempre devuelve `200 OK` aunque `result.status === 'error'`. Clientes A2A que usan HTTP status codes no pueden distinguir éxito de fallo del upstream.

**Paths afectados:**
- **Route A (agent-key):** `buildResponse(...)` en línea ~412. Budget NO se deduce cuando falla (ya correcto). `charged: 0`.
- **Route B (x402):** `buildResponse(...)` en línea ~559. El settlement ya ocurrió on-chain ANTES de llamar al upstream. `charged: 0` es incorrecto aquí — el dinero SÍ salió. NO usar `refunded: true`.

**Decisión de diseño (PO):**
- Route A error → `502` / `503` / `504` según el tipo, `meta.charged: 0`
- Route B error → `502` / `503` / `504` según el tipo, `meta.charged: 0` se mantiene para no confundir (el contrato ya lo manejó), agregar `meta.upstream_failed: true` para que el caller sepa que el settlement ocurrió pero el upstream no respondió

## Acceptance Criteria
- AC1: WHEN upstream devuelve 4xx THEN WasiAI responde `502 Bad Gateway`
- AC2: WHEN upstream devuelve 5xx THEN WasiAI responde `503 Service Unavailable`
- AC3: WHEN upstream da timeout (AbortError / TimeoutError) THEN WasiAI responde `504 Gateway Timeout`
- AC4: WHEN upstream es unreachable (connection error) THEN WasiAI responde `502 Bad Gateway`
- AC5: WHEN la llamada es exitosa THEN se mantiene `200 OK`
- AC6: WHEN es Route B (x402) y upstream falla THEN `meta.upstream_failed: true` está presente en el body
- AC7: WHEN es Route A (agent-key) y upstream falla THEN `meta.charged: 0` (sin cambio — ya correcto)
- AC8: WHEN el circuit breaker está OPEN THEN la respuesta existente de circuit breaker NO cambia (out-of-scope)

## Wave 0 — Pre-flight
- [ ] Leer `callUpstream` completo (líneas 613-665)
- [ ] Leer `buildResponse` completo (líneas 718-760)
- [ ] Leer los dos call sites de `buildResponse` (Route A ~412, Route B ~559)
- [ ] Identificar qué tipo de error devuelve `callUpstream` para cada caso (4xx, 5xx, timeout, unreachable)
- [ ] Build gate: `npx tsc --noEmit`

## Wave 1 — Extender callUpstream para exponer error type
**Archivo:** `src/app/api/v1/models/[slug]/invoke/route.ts`

Reemplazar el cuerpo completo de `callUpstream` desde `const startMs` hasta el `return` final:

```typescript
  const startMs = Date.now()
  let data: unknown
  let status: 'success' | 'error' = 'success'
  // WAS-284: hint para mapear el error del upstream al HTTP status correcto en buildResponse
  let httpStatusHint: 502 | 503 | 504 | undefined = undefined

  try {
    const upstream = await wrapWithCircuitBreaker(
      slug,
      async () => {
        const res = await retryWithBackoff(
          () => fetch(model.endpoint_url as string, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...((model.webhook_secret as string | null) ? {
                'Authorization': `Bearer ${model.webhook_secret}`,
                'X-WasiAI-Agent-Id': model.id as string,
              } : {}),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
          })
        )
        if (!res.ok && res.status >= 500) {
          throw new Error(`Upstream HTTP ${res.status}`)
        }
        return res
      },
      model.user_id as string
    )
    data = upstream.ok ? await upstream.json() : { error: `Upstream ${upstream.status}` }
    if (!upstream.ok) {
      status = 'error'
      // WAS-284: 4xx no lanza — se detecta aquí, después del wrapper
      httpStatusHint = 502  // client error del upstream → Bad Gateway
    }
  } catch (err) {
    status = 'error'
    // WAS-284: discriminar tipo de error para HTTP status correcto
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      // AbortSignal.timeout() lanza DOMException con name='TimeoutError' en Node.js 18+
      data = { error: 'Upstream timeout', detail: 'Endpoint did not respond within 10 seconds.' }
      httpStatusHint = 504
    } else if (err instanceof Error && /^Upstream HTTP (\d+)$/.test(err.message)) {
      // Error sintético lanzado por el wrapper para 5xx: 'Upstream HTTP 503' etc.
      const upstreamStatus = Number(err.message.match(/\d+/)?.[0] ?? 502)
      data = { error: `Upstream ${upstreamStatus}` }
      httpStatusHint = upstreamStatus >= 500 ? 503 : 502
    } else {
      // Connection error (TypeError ECONNREFUSED, ENOTFOUND, etc.)
      data = { error: 'Upstream unreachable', detail: String(err) }
      httpStatusHint = 502
    }
  }

  return { data, status, latencyMs: Date.now() - startMs, httpStatusHint }
```

**Build gate:** `npx tsc --noEmit`

## Wave 2 — Modificar buildResponse para aceptar httpStatus y upstream_failed
**Archivo:** `src/app/api/v1/models/[slug]/invoke/route.ts`

Reemplazar la firma y el cuerpo completo de `buildResponse`:

```typescript
function buildResponse(
  model: Record<string, unknown>,
  result: { data: unknown; status: string; latencyMs: number; httpStatusHint?: number },
  txHash?: string,
  receiptSignature?: string,
  pricingInfo?: PricingInfo,
  callId?: string,
  options?: { upstreamFailed?: boolean },  // WAS-284: true solo en Route B (x402) cuando upstream falla
) {
  // WAS-284: propagar el HTTP status del upstream cuando hay error
  const httpStatus = result.status === 'error' && result.httpStatusHint
    ? result.httpStatusHint
    : 200

  return NextResponse.json(
    {
      result: result.data,
      meta: {
        model: model.slug,
        latency_ms: result.latencyMs,
        charged: result.status === 'success'
          ? (pricingInfo?.totalPrice ?? Number(model.price_per_call))
          : 0,
        charged_breakdown: result.status === 'success' && pricingInfo
          ? { creator: pricingInfo.creatorPrice, overhead: pricingInfo.overhead }
          : undefined,
        currency: 'USDC',
        chain: CHAIN_NAME,
        tx_hash: txHash ?? null,
        status: result.status,
        call_id: callId ?? undefined,
        // WAS-284: upstream_failed = true en Route B cuando el settlement ocurrió pero el upstream falló
        ...(options?.upstreamFailed ? { upstream_failed: true } : {}),
      },
      receipt: receiptSignature
        ? { signature: receiptSignature }
        : undefined,
      pricing: pricingInfo
        ? {
            creator_price:     pricingInfo.creatorPrice,
            platform_overhead: pricingInfo.overhead,
            total:             pricingInfo.totalPrice,
            breakdown:         pricingInfo.breakdown,
          }
        : undefined,
    },
    { status: httpStatus, headers: X402_CORS_HEADERS },
  )
}
```

Actualizar call sites (solo la firma, no la lógica circundante):
- Route A (`~412`): sin cambio — `httpStatusHint` ya viene en `result`, el 7mo arg es undefined por default
- Route B (`~559`): cambiar a:
  `buildResponse(model, result, settlement.transactionHash, undefined, { creatorPrice, overhead, totalPrice, breakdown }, callId ?? undefined, { upstreamFailed: result.status === 'error' })`

**Build gate:** `npx tsc --noEmit`

## Rollback
`git revert HEAD` — un solo archivo, sin migraciones.

## Critical Constraints
- PROHIBIDO cambiar el HTTP status cuando `result.status === 'success'` — siempre 200
- PROHIBIDO agregar `refunded: true` en ningún path (semánticamente incorrecto para x402)
- PROHIBIDO modificar la lógica del circuit breaker o el retry
- OBLIGATORIO que el campo `upstream_failed` solo aparezca en Route B cuando el upstream falla
