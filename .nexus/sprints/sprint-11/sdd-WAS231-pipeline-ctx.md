# SDD WAS-231: Pipeline Context Propagation — Expandir pipelineCtx entre steps

> SPEC_APPROVED: no
> Fecha: 2026-03-17
> Tipo: improvement
> SDD_MODE: full
> Branch: main (direct commit)

---

## 1. Resumen

El Compose API ya propaga `token_address` y `token_symbol` entre steps via `pipelineCtx`.
Esta HU expande ese contexto para incluir campos clave del output de cada agente DeFi,
de modo que los steps siguientes reciban datos enriquecidos del pipeline acumulado.

El contexto viaja en el body de cada llamada al agente endpoint:
`{ input: "...", token_address: "0x...", price_usd: 10.26, sentiment_score: 20, ... }`

Los agentes pueden leerlo o ignorarlo — la retrocompatibilidad está garantizada.

**Scope:** Solo la capa Compose API (`compose/route.ts`). No se modifican los agentes endpoints.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | WAS-231 |
| **Tipo** | improvement |
| **SDD_MODE** | full |
| **Objetivo** | Expandir pipelineCtx de 2 campos a ~12 campos cubriendo todos los agentes DeFi actuales |
| **Reglas de negocio** | Campo más reciente sobreescribe campo anterior (AC4). No sobreescribir campos del input explícito del usuario. |
| **Scope IN** | `src/app/api/v1/compose/route.ts` — función de extracción de ctx post-step |
| **Scope OUT** | Agentes endpoints, schema validation, pass_output behavior, DB, contratos |
| **Missing Inputs** | N/A |

### Acceptance Criteria (EARS)

1. WHEN `wasi-chainlink-price` completa con éxito, THE pipelineCtx SHALL incluir: `price_usd`, `token_symbol`, `token_address`, `volatility_7d_pct`
2. WHEN `wasi-defi-sentiment` completa con éxito, THE pipelineCtx SHALL incluir: `sentiment_score`, `token_name`, `token_symbol`
3. WHEN `wasi-onchain-analyzer` completa con éxito, THE pipelineCtx SHALL incluir: `token_address`, `holder_count`, `contract_age_days`, `top10_concentration_pct`
4. WHEN `wasi-contract-auditor` completa con éxito, THE pipelineCtx SHALL incluir: `is_verified`, `bytecode_size`
5. IF un campo ya existe en pipelineCtx, THEN THE step más reciente SHALL sobreescribir el valor
6. WHEN se llama al endpoint de cualquier agente, THE body SHALL incluir todos los campos de pipelineCtx acumulados hasta ese step
7. THE tipo de pipelineCtx SHALL cambiar de `Record<string, string>` a `Record<string, string | number | boolean>` para soportar valores numéricos sin serialización incorrecta

## 3. Context Map

### Archivos leídos
| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/api/v1/compose/route.ts` línea 422 | Definición de pipelineCtx | `Record<string, string>` — necesita expandirse |
| `src/app/api/v1/compose/route.ts` líneas 575-578 | Extracción actual de 2 campos | Patrón a expandir |
| `src/app/api/v1/compose/route.ts` línea 486 | Cómo se envía al endpoint | `{ input: stepInput, ...pipelineCtx }` — ya funciona, solo necesita más campos |

### Campos reales de los agentes (verificados en step_outputs prod)
| Agente | Campos del result disponibles |
|--------|------------------------------|
| `wasi-chainlink-price` | `feed_address`, `token_symbol`, `price_usd`, `timestamp`, `round_id`, `history`, `volatility_7d_pct`, `metrics` |
| `wasi-defi-sentiment` | `token_name`, `token_symbol`, `sentiment_score`, `flags`, `market_signals`, `analysis` |
| `wasi-onchain-analyzer` | `token_address`, `name`, `symbol`, `total_supply`, `decimals`, `contract_age_days`, `holder_count`, `top10_concentration_pct` |
| `wasi-contract-auditor` | `token_address`, `bytecode_size`, `is_verified`, `dangerous_selectors`, `abi_functions`, `findings`, `summary` |
| `wasi-risk-report` | `token_address`, `generated_at`, `risk_score`, `agents`, `summary` |

### Exemplar
| Para modificar | Seguir patrón de | Razón |
|---------------|------------------|-------|
| Bloque extracción ctx (líneas 575-578) | El bloque existente mismo | Misma estructura, solo más campos |

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|----------|
| `src/app/api/v1/compose/route.ts` | Modificar | Cambiar tipo pipelineCtx + expandir extracción de campos | Bloque líneas 575-578 |

### 4.2 Cambio de tipo

```
// Antes:
const pipelineCtx: Record<string, string> = {}

// Después:
const pipelineCtx: Record<string, string | number | boolean> = {}
```

### 4.3 Campos a extraer por agente

Helper function `extractCtxFields(out: Record<string, unknown>)` que retorna solo campos primitivos relevantes:

```
De cualquier output:
  token_address, token_symbol, token_name (string)

De chainlink-price output:
  price_usd (number), volatility_7d_pct (number)

De defi-sentiment output:
  sentiment_score (number)

De onchain-analyzer output:
  holder_count (number), contract_age_days (number), top10_concentration_pct (number)

De contract-auditor output:
  is_verified (boolean), bytecode_size (number)
```

La función itera el output `result` (o el objeto raíz si no hay `result`) y extrae solo los campos que existen y son del tipo esperado.

### 4.4 Flujo principal (Happy Path)

1. Step 0 (chainlink-price) completa → extrae `price_usd: 10.26`, `token_symbol: "AVAX"`, `volatility_7d_pct: 0.62` → pipelineCtx actualizado
2. Step 1 (defi-sentiment) recibe body `{ input: "{\"token\":\"AVAX\"}", price_usd: 10.26, token_symbol: "AVAX" }` → puede usar o ignorar → completa → extrae `sentiment_score: 20`
3. Step 2 (onchain-analyzer) recibe body con todos los campos acumulados → puede usar contexto de los 2 steps anteriores
4. Y así sucesivamente

### 4.5 Flujo de error

- Si el output no tiene `result` o no es objeto → extracción devuelve `{}` → pipelineCtx no se actualiza → pipeline continúa normalmente

## 5. Constraint Directives

### OBLIGATORIO seguir
- No romper retrocompatibilidad: si un campo no existe en el output, simplemente no se agrega al ctx
- Tipo check estricto: solo extraer campos si son del tipo primitivo esperado (`number`, `string`, `boolean`)
- No exponer `history`, `findings`, `abi_functions` ni arrays — solo primitivos escalares

### PROHIBIDO
- NO modificar la lógica de cobro ni schema validation
- NO cambiar `pass_output` behavior
- NO modificar endpoints de agentes
- NO agregar campos que sean arrays u objetos al ctx (solo primitivos)
- NO sobreescribir el `input` del usuario con campos del ctx

## 6. Scope

**IN:**
- Tipo de `pipelineCtx` de `string` a `string | number | boolean`
- Helper `extractCtxFields()` en compose/route.ts
- Llamada a helper después de cada step exitoso

**OUT:**
- Agentes endpoints
- Schema validation
- DB, contratos, SDDs de agentes

## 7. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Campo numérico se serializa mal en JSON body | Baja | Media | Tipo explícito + `JSON.stringify` maneja números nativamente |
| Agente endpoint falla si recibe campos inesperados | Baja | Media | Todos los agentes actuales son de WasiAI y los endpoints ignoran campos extras |
| ctx crece indefinidamente en pipeline de 5 steps | Muy baja | Baja | Solo primitivos escalares — max ~15 campos, ~300 bytes |

---

*SDD generado por NexusAgil — FULL*
