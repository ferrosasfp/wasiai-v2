# SDD WAS-199: /reputation endpoint — añadir performance_score + reputation_score + erc8004

> SPEC_APPROVED: no
> Fecha: 2026-03-14
> Tipo: improvement
> SDD_MODE: full
> Branch: feat/199-reputation-endpoint-gaps

---

## 1. Resumen

El endpoint `GET /api/v1/agents/:slug/reputation` existe y funciona (WAS-185). Tiene tres gaps contra el Work Item original de WAS-199: (1) no incluye `performance_score` (WAS-213), (2) no diferencia `performance_score` de `reputation_score` (votos) — ambos son "scores" distintos, (3) `erc8004_score` es `null` placeholder cuando podría ser la normalización de `reputation_score`. Se corrigen los tres gaps.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | WAS-199 |
| **Tipo** | improvement |
| **Objetivo** | Añadir `performance_score`, `reputation_score` (votos) y `erc8004_score` real al response de `/reputation` |
| **Scope IN** | `src/app/api/v1/agents/[slug]/reputation/route.ts` únicamente |
| **Scope OUT** | Cambiar la fórmula del `score` compuesto, cambiar el rate limiter, WAS-194 on-chain, `format_compliance_pct` |

## 3. Context Map

### Archivos leídos
| Archivo | Por qué | Patrón extraído |
|---------|---------|----------------|
| `src/app/api/v1/agents/[slug]/reputation/route.ts` | Archivo a modificar | SELECT actual: `id, total_calls, reputation_score, is_verified, last_health_check_ok, last_health_check_at` — falta `performance_score` |
| `src/app/api/v1/agents/[slug]/route.ts` | Exemplar de cómo se expone `performance_score` | `performance_score: agent.performance_score ?? null` |

### Estado de BD
| Tabla | Columnas relevantes |
|-------|---------------------|
| `agents` | `reputation_score DECIMAL(3,2)` (votos 0-1), `reputation_count INT`, `performance_score DECIMAL(5,1) NULL` (0-100, WAS-213) |

### Gap identificado
El SELECT actual no incluye `performance_score`. Tampoco diferencia qué es `reputation_score` (votos) del `score` calculado (multi-factor).

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|---------|
| `src/app/api/v1/agents/[slug]/reputation/route.ts` | Modificar | Añadir `performance_score` al SELECT y al response; añadir `reputation_score` (votos) al response; calcular `erc8004_score` real | mismo archivo |

### 4.2 Cambios en el SELECT

Añadir `performance_score` al `.select(...)` de Supabase:

```
'id, total_calls, reputation_score, reputation_count, is_verified, last_health_check_ok, last_health_check_at, performance_score'
```

### 4.3 Cambios en el response JSON

**Añadir al response existente:**

```json
{
  "performance_score": 94.5,         // WAS-213: 0-100, null si <5 calls
  "reputation_score": 0.82,          // votos: 0.0-1.0, null si sin votos
  "reputation_count": 47,            // número de votos
  "erc8004_score": 0.82              // = reputation_score (votos normalizados 0-1)
}
```

**Fórmula `erc8004_score`:**
- `erc8004_score = agent.reputation_score ?? null`
- Es exactamente `reputation_score` (ya está en escala 0-1 en la DB)
- Cuando WAS-194 implemente on-chain real, este campo se actualizará

**Campos existentes que NO cambian:**
- `score` (compuesto multi-factor 0-100)
- `p50_ms`, `p95_ms`, `error_rate_7d`, `trend`, `invocation_count`, `is_available`, `is_verified`, `dispute_rate`, `last_invocation_at`

### 4.4 Flujo principal (Happy Path)

1. `GET /api/v1/agents/wasi-defi-sentiment/reputation`
2. Supabase query incluye `performance_score`
3. Response incluye `performance_score: 94.5`, `reputation_score: 0.82`, `reputation_count: 47`, `erc8004_score: 0.82`

### 4.5 Flujo de error

- Agente nuevo sin calls: `performance_score: null`
- Agente sin votos: `reputation_score: null`, `reputation_count: 0`, `erc8004_score: null`

## 5. Constraint Directives

### OBLIGATORIO
- `performance_score` en el SELECT de Supabase ANTES de usarlo en el response
- `erc8004_score = agent.reputation_score ?? null` — exactamente igual, no calcular nada nuevo
- `reputation_score` en el response debe ser el valor de votos (0-1), NO el `score` compuesto
- Mantener el campo `score` existente (compuesto multi-factor) — no renombrarlo ni eliminarlo

### PROHIBIDO
- NO cambiar la fórmula de `calcScore()`
- NO cambiar el rate limiter
- NO tocar `calcTrend()`
- NO cambiar campos del response existentes (solo añadir)
- NO implementar `format_compliance_pct` (placeholder null, ya existente)

## 6. Scope

**IN:**
- `performance_score` en SELECT + response
- `reputation_score` (votos) en response
- `reputation_count` en response
- `erc8004_score = reputation_score` (real, no null)

**OUT:**
- `format_compliance_pct` (WAS-202, null placeholder queda)
- on-chain erc8004 real (WAS-194)
- Cambios de fórmula

## 7. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| Ambigüedad de nombres: `score` vs `performance_score` vs `reputation_score` | Media | Medio | Documentar en comentario: `score` = multi-factor compuesto, `performance_score` = solo error_rate WAS-213, `reputation_score` = votos |

## 8. Dependencias
- WAS-213 migración 058 (done) — `performance_score` existe en prod

---

*SDD generado por NexusAgil — FULL*
