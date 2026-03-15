# SDD #S7-04: WAS-207 — POST /introspect

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: feature
> SDD_MODE: full
> Branch: feat/s7-04-introspect

## 1. Resumen
Nuevo endpoint `POST /api/v1/agents/:slug/introspect` que permite a desarrolladores obtener un COB (Capability Object Bundle) firmado con el estado interno del agente para debugging. Tres niveles de profundidad (`shallow/mid/full`) con pricing x402 diferenciado. Demanda directa de la comunidad (waypoint/Bert en Moltbook).

## 2. Work Item
| Campo | Valor |
|-------|-------|
| **#** | S7-04 / WAS-207 |
| **Tipo** | feature |
| **Objetivo** | Endpoint de introspección con COB firmado + pricing por depth + auth dual (agent key / x402) |
| **Scope IN** | Nuevo route, COB builder, EIP-712 firma con operator wallet, pricing tiers |
| **Scope OUT** | UI visualizador de COBs, storage persistente de COBs, introspección del agente upstream (responsabilidad del publisher) |

### Acceptance Criteria (EARS)
1. WHEN `POST /api/v1/agents/:slug/introspect` receives valid body `{ runtime, target, depth, timeout_ms }`, THE system SHALL return HTTP 200 con COB firmado.
2. WHEN `depth = "shallow"`, THE price SHALL be $0.10 USDC. WHEN `depth = "mid"` → $0.25. WHEN `depth = "full"` → $0.50.
3. WHEN caller has no payment, THE system SHALL return HTTP 402 con x402 requirements incluyendo el price correcto para el depth solicitado.
4. WHEN the COB is generated, THE `operator_signature` SHALL be EIP-712 signed by the operator wallet.
5. WHEN `depth` is "shallow" or "mid", THE `memory_diffs` SHALL be incremental (not full blob).
6. WHEN call exceeds `timeout_ms`, THE system SHALL return partial COB with `truncated: true`.
7. WHEN caller sends valid agent key with sufficient budget, THE system SHALL process without 402.

## 3. Context Map

### Archivos leídos
| Archivo | Por qué | Patrón |
|---------|---------|--------|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Patrón de auth dual + 402 flow | Mismo patrón: agent key path A / x402 path B |
| `src/lib/receipts/signReceipt.ts` | Patrón de firma EIP-712 con operator wallet | Replicar para COB signature |
| `src/app/api/v1/agents/[slug]/reputation/route.ts` | Patrón de route con slug | Estructura de route con parámetro dinámico |

### Exemplars
| Para crear | Seguir patrón de |
|-----------|-----------------|
| `route.ts` nueva | `invoke/route.ts` (auth dual, 402, headers CORS) |
| COB signature | `signReceipt.ts` (EIP-712 con operator wallet) |

### Estado de BD
| Tabla | Existe | Relevante |
|-------|--------|-----------|
| `agents` | Sí | `slug`, `status`, `price_per_call`, `endpoint_url` (privado), `creator_id` |
| `agent_calls` | Sí | Loguear invocaciones de introspect |

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar
| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `src/app/api/v1/agents/[slug]/introspect/route.ts` | Crear | Endpoint principal |
| `src/lib/introspect/buildCOB.ts` | Crear | Builder de COB + signature |

### 4.2 Request schema
```typescript
type IntrospectRequest = {
  runtime: string           // "wasiai-v1" | custom
  target: string            // qué inspeccionar
  depth: "shallow" | "mid" | "full"
  breakpoints?: string[]    // opcional
  timeout_ms?: number       // default 5000
  max_response_size_mb?: number // default 1
}
```

### 4.3 Pricing por depth
```typescript
const INTROSPECT_PRICE: Record<string, number> = {
  shallow: 0.10,
  mid:     0.25,
  full:    0.50,
}
```

### 4.4 COB response
```typescript
type COB = {
  agent_slug:         string
  depth:              "shallow" | "mid" | "full"
  state_snapshots:    object[]
  call_trace:         object[]
  memory_diffs:       object[]   // incremental para shallow/mid
  timing_profile:     object
  erc8004_identity:   string     // on-chain identity ref
  operator_signature: string     // EIP-712 del operator wallet
  truncated:          boolean
  truncated_reason?:  string
  generated_at:       number     // unix timestamp
}
```

### 4.5 Flujo principal
1. Validar body (depth requerido, valores válidos)
2. Lookup del agente por slug
3. Auth check: agent key path A (deducir budget) o x402 path B (402 → settle)
4. Price = `INTROSPECT_PRICE[depth]`
5. Llamar upstream `endpoint_url` con body de introspección + timeout
6. Construir COB con response + metadata
7. Firmar COB con operator wallet (EIP-712 simplificado — hash del COB)
8. Retornar COB firmado
9. `logCall()` con `payment_type=null` — NO extender la firma de logCall en este sprint

### 4.6 Flujo de error
- Agente no encontrado → 404
- depth inválido → 400
- Sin payment → 402 con precio correcto para el depth
- Timeout upstream → COB parcial con `truncated: true`
- Firma falla → COB sin firma, `operator_signature: null`, log warning

## 5. Constraint Directives

### OBLIGATORIO seguir
- Auth dual: exactamente mismo patrón que `invoke/route.ts` (agent key path A / x402 path B)
- CORS headers: mismos que invoke
- `logCall()` con agent_slug y status
- `signReceipt.ts` como referencia para firma EIP-712

### PROHIBIDO
- NO exponer `endpoint_url` del agente en el COB response
- NO implementar storage persistente de COBs
- NO hacer llamada real al upstream si no hay payment válido
- NO añadir dependencias nuevas para la firma — usar viem ya disponible

## 6. Riesgos
| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| Upstream no implementa introspect → responde error | A | COB con state_snapshots=[] + truncated=false (COB vacío válido) |
| Firma EIP-712 requiere ABI complejo | M | Firmar `keccak256(JSON.stringify(cob))` como bytes32 — simple y verificable |

---
*SDD — FULL | Sprint 7*
