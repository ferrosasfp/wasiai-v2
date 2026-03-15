# SDD WAS-187: discoverAgent rankea por performance_score

> SPEC_APPROVED: no
> Fecha: 2026-03-14
> Tipo: improvement
> SDD_MODE: full
> Branch: feat/187-discover-agent-ranking

---

## 1. Resumen

`discoverAgent` en `src/lib/agent-discovery.ts` ordena candidatos por `reputation_score` (votos subjetivos, frecuentemente null en agentes nuevos). Esto hace que agentes sin votos nunca sean seleccionados incluso si tienen excelente performance operacional. El fix: ordenar por `performance_score DESC NULLS LAST` primero, luego `reputation_score`, luego precio. Además, añadir soporte para `min_performance` como constraint nuevo (sin tocar `min_reputation`).

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | WAS-187 |
| **Tipo** | improvement |
| **Objetivo** | Cambiar ranking de discovery dinámico para priorizar performance operacional sobre votos |
| **Scope IN** | `src/lib/agent-discovery.ts` |
| **Scope OUT** | `src/app/api/v1/compose/route.ts`, `src/app/api/v1/agents/discover/route.ts`, `min_reputation` (backward compat) |

## 3. Context Map

### Archivos leídos
| Archivo | Por qué | Patrón extraído |
|---------|---------|----------------|
| `src/lib/agent-discovery.ts` | Archivo a modificar | SELECT actual no incluye `performance_score`; ordena por `reputation_score` |
| `src/app/api/v1/compose/route.ts` | Consumidor de `discoverAgent` | Llama con `constraints` — añadir `min_performance` no requiere cambios en compose |

### Estado de BD
| Tabla | Columnas relevantes |
|-------|---------------------|
| `agents` | `reputation_score DECIMAL(3,2)` (0-1), `performance_score DECIMAL(5,1) NULL` (0-100) |

### Gap identificado
- `performance_score` no está en el SELECT de `discoverAgent`
- Orden actual: `reputation_score DESC NULLS LAST, price_per_call ASC`
- `constraints.min_reputation` filtra por `reputation_score` — correcto, no cambia
- Falta: constraint `min_performance` para filtrar por `performance_score`

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|---------|
| `src/lib/agent-discovery.ts` | Modificar | Añadir `performance_score` al SELECT, cambiar orden, añadir `min_performance` a `DiscoveryConstraints` | mismo archivo |

### 4.2 Cambios en DiscoveryConstraints

```typescript
interface DiscoveryConstraints {
  max_price_usdc?: number
  min_reputation?: number   // votos — NO cambia semántica
  min_performance?: number  // performance_score 0-100 — NUEVO
  category?: string
}
```

### 4.3 Cambios en el SELECT

Añadir `performance_score` al select:
```
'id, slug, name, category, price_per_call, endpoint_url, status, max_rpm, max_rpd, capabilities, reputation_score, performance_score'
```

### 4.4 Cambios en el filtrado

Añadir después del filtro de `min_reputation`:
```typescript
if (constraints.min_performance !== undefined) {
  query = query.gte('performance_score', constraints.min_performance)
}
```

### 4.5 Cambios en el ordering

Reemplazar:
```typescript
.order('reputation_score', { ascending: false, nullsFirst: false })
.order('price_per_call', { ascending: true })
```

Por:
```typescript
.order('performance_score', { ascending: false, nullsFirst: false })
.order('reputation_score', { ascending: false, nullsFirst: false })
.order('price_per_call', { ascending: true })
```

### 4.6 DiscoveredAgent interface

Añadir `performance_score` al interface:
```typescript
export interface DiscoveredAgent {
  // ... campos existentes ...
  performance_score: number | null  // NUEVO
}
```

### 4.7 Flujo principal (Happy Path)

1. Compose recibe step con `capability: "defi-analysis"`
2. `discoverAgent` busca agentes activos con esa capability
3. Ordena: `performance_score DESC` → agente con mejor performance operacional primero
4. Si empatan en performance: `reputation_score DESC` → más votos primero
5. Si empatan en ambos: `price_per_call ASC` → más barato primero
6. Retorna el mejor candidato dentro del scope

### 4.8 Flujo de error

- Todos los candidatos tienen `performance_score = null` → Supabase `NULLS LAST` los pone al final, pero como todos son null, el segundo criterio (`reputation_score`) decide
- Ningún candidato cumple `min_performance` → retorna `null` → compose retorna `no_agent_match`

## 5. Constraint Directives

### OBLIGATORIO
- `performance_score` en el SELECT antes de usarlo en el ORDER
- `min_reputation` sigue filtrando `reputation_score` — no cambiar semántica
- `min_performance` filtra `performance_score` — nuevo constraint
- `nullsFirst: false` en todos los orderings (agentes sin datos van al final)
- Añadir `performance_score` al interface `DiscoveredAgent`

### PROHIBIDO
- NO cambiar `compose/route.ts`
- NO cambiar el endpoint público `GET /api/v1/agents/discover`
- NO eliminar o cambiar `min_reputation`
- NO cambiar la lógica de scope check (`isAgentInScope`)
- NO añadir dependencias nuevas

## 6. Scope

**IN:**
- `performance_score` en SELECT + interface `DiscoveredAgent`
- Nuevo constraint `min_performance`
- Cambio de ordering: `performance_score` primero, luego `reputation_score`, luego `price_per_call`

**OUT:**
- `compose/route.ts` — no requiere cambios
- `GET /api/v1/agents/discover` — no requiere cambios (acepta `min_performance` si ya estaba en `DiscoveryConstraints`)
- Cambios en `min_reputation`

## 7. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| Agentes existentes sin `performance_score` nunca seleccionados | Alta | Medio | `NULLS LAST` los pone al final pero siguen en el pool; se seleccionan si son los únicos candidatos |
| `min_performance` en Supabase `.gte()` con campo null — ¿filtra correcto? | Media | Medio | Supabase `.gte('performance_score', 90)` excluye nulls por comportamiento de PostgreSQL — correcto |

## 8. Dependencias
- WAS-213 migración 058 (done) — `performance_score` existe en prod

---

*SDD generado por NexusAgil — FULL*
