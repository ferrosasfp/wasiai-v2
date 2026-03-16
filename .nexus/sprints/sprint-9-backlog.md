# Sprint 9 — Zero Friction + Deuda Técnica

**Fecha:** 2026-03-15  
**Objetivo:** Eliminar fricción de input para devs y agentes IA, hacer `input_schema` obligatorio con generación automática de ejemplos, y limpiar deuda técnica crítica.

---

## Backlog Priorizado

| # | ID | Título | Tipo | Clasificación | Prioridad | Depende de |
|---|----|----|------|---------------|-----------|-----------|
| 1 | WAS-206 | input_schema obligatorio + buildExampleFromSchema inteligente + preview en formulario | Feature | HU-MAJOR | 🔴 Alta | — |
| 2 | WAS-205 | Zero-Friction Input: pre-loaded examples en todas las superficies (Free Trial, Sandbox, TryIt, API) | Feature | HU-MAJOR | 🔴 Alta | WAS-206 |
| 3 | DEUDA-01 | `GET /api/v1/agents/[slug]` no expone `metadata.input_example` ni `example_input` resuelto | Deuda técnica | FAST-FIX | 🟡 Media | WAS-206 |
| 4 | DEUDA-02 | `GET /api/v1/agents/[slug]` y `GET /api/v1/agents` sin try/catch — un error de Supabase devuelve 500 sin manejo | Deuda técnica | FAST-FIX | 🟡 Media | — |
| 5 | DEUDA-03 | `NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA` hardcodeado en UI, no como variable de entorno real — activar en prod | Config | FAST-FIX | 🟡 Media | WAS-206 |

---

## Descripción de cada issue

### WAS-206 — input_schema obligatorio + ejemplo inteligente
- Activar `input_schema` como campo obligatorio en formulario de publicación
- Mejorar `buildExampleFromSchema` para inferir valores reales (no `<placeholder>`):
  - Detectar por descripción: "address", "0x..." → `"0xABC123..."`
  - Detectar: "symbol", "token" → `"AVAX"`
  - Detectar: "wallet" → `"0x0000..."`
  - Campos `optional`/sin `required` → omitir del ejemplo
- Agregar preview editable en tiempo real en `Step3Technical.tsx`
- Guardar el ejemplo aprobado por el dev como `metadata.input_example`

### WAS-205 — Zero-Friction en todas las superficies
- `SandboxClient.tsx` — fetch dinámico de `example_input` al seleccionar agente
- `TryIt.tsx` — reemplazar `EXAMPLE_PAYLOADS` hardcodeado por fetch dinámico  
- `GET /api/v1/agents/{slug}` — exponer `example_input` resuelto (jerarquía: metadata → capabilities → schema → fallback)
- Validar que JSON de BD sea válido antes de usarlo

### DEUDA-01 — API no expone example_input
- `GET /api/v1/agents/[slug]` añadir campo `example_input` calculado en la respuesta
- `GET /api/v1/agents` (list) añadir `example_input` en cada item
- Usar función centralizada `resolveExampleInput(agent)`

### DEUDA-02 — API sin manejo de errores
- `GET /api/v1/agents/[slug]/route.ts` — envolver en try/catch
- `GET /api/v1/agents/discover/route.ts` — envolver en try/catch
- Devolver `{ error: 'internal_error' }` con 500 en vez de crash

### DEUDA-03 — Activar input_schema obligatorio en prod
- Agregar `NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=true` en Vercel env de `wasiai-prod`
- Agregar en `wasiai-v2` (testnet) también

---

## Orden de ejecución

```
DEUDA-02 (paralelo)  ─┐
DEUDA-03 (paralelo)  ─┤→ WAS-206 → DEUDA-01 → WAS-205
```

- DEUDA-02 y DEUDA-03 son independientes y rápidos → ejecutar en paralelo primero
- WAS-206 debe ir antes de WAS-205 (dependencia de fuente de datos)
- DEUDA-01 va después de WAS-206 (necesita la función `resolveExampleInput`)

---

## Estimado
- DEUDA-02: ~30 min
- DEUDA-03: ~10 min  
- WAS-206: ~2h
- DEUDA-01: ~30 min
- WAS-205: ~1.5h

**Total estimado: ~4.5h**

---

## Backlog post-Sprint 9 (hallazgos de pruebas integrales)

### BUG-01 — liquidity-analyzer: summary.total_liquidity_usd es null
- **Agente:** wasi-liquidity-analyzer
- **Síntoma:** `summary.total_liquidity_usd` y `summary.total_volume_24h` devuelven null
- **Causa probable:** El handler no agrega los valores de `pairs[]`
- **Impacto:** Bajo — pares individuales tienen valores correctos
- **Prioridad:** P3

### BUG-02 — risk-report: recommendation vacío para tokens SAFE
- **Agente:** wasi-risk-report
- **Síntoma:** `recommendation` field vacío cuando `rating === "SAFE"`
- **Causa probable:** El prompt del LLM no fuerza recommendation cuando el riesgo es bajo
- **Impacto:** Bajo — cosmético
- **Prioridad:** P3

### DEUDA-04 — PayToCallButton: no usa resolveExampleInput (solo buildExampleFromSchema)
- **Archivo:** src/features/payments/components/PayToCallButton.tsx línea 196
- **Síntoma:** Lee `metadata.input_example` directamente en lugar de usar resolveExampleInput con jerarquía completa
- **Prioridad:** P3

### DEUDA-05 — /api/v1/agents?slim=true no incluye metadata/input_example
- **Síntoma:** Slim mode no expone example_input (retorna objeto sin ese campo)
- **Impacto:** Bajo — slim mode es solo para listados ligeros sin ejemplo
- **Prioridad:** P4
