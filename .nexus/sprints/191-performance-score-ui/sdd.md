# SDD WAS-191: performance_score badge en perfil del agente

> SPEC_APPROVED: no
> Fecha: 2026-03-14
> Tipo: improvement
> SDD_MODE: full
> Branch: feat/191-performance-score-ui

---

## 1. Resumen

La página de perfil del agente (`/models/:slug`) muestra el score de votos (AgentRating) pero no muestra el `performance_score` operacional (WAS-213). Agentes autónomos que parsean el perfil para decidir si invocar a otro agente necesitan ver este dato de forma prominente. Se añade un badge de Performance junto al AgentRating existente.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | WAS-191 |
| **Tipo** | improvement |
| **Objetivo** | Mostrar `performance_score` (0-100) con color semafórico junto al AgentRating en la página del agente |
| **Scope IN** | `src/app/[locale]/models/[slug]/page.tsx`, nuevo componente `PerformanceBadge` |
| **Scope OUT** | API changes, `reputation_score` (votos), on-chain logic |

## 3. Context Map

### Archivos leídos
| Archivo | Por qué | Patrón extraído |
|---------|---------|----------------|
| `src/app/[locale]/models/[slug]/page.tsx` | Archivo a modificar | Usa `getModelBySlug` con `select('*')` — `performance_score` ya viene en el response |
| `src/features/reputation/components/AgentRating.tsx` | Componente existente junto al badge | Patrón de componente de rating |

### Estado de BD relevante
| Tabla | Existe | Columnas relevantes |
|-------|--------|---------------------|
| `agents` | Sí | `performance_score DECIMAL(5,1) NULL` — añadida en migración 058 |

### Componentes reutilizables
- `AgentRating` en `src/features/reputation/components/` — referencia de proximidad en el layout
- `getModelBySlug` ya hace `select('*')` — `performance_score` ya está disponible, no requiere cambio de query

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|---------|
| `src/features/models/types/models.types.ts` | Modificar | Añadir `performance_score?: number \| null` al tipo `Model` | mismo archivo |
| `src/features/reputation/components/PerformanceBadge.tsx` | Crear | Badge con performance_score y color semafórico | `AgentRating.tsx` |
| `src/app/[locale]/models/[slug]/page.tsx` | Modificar | Importar y renderizar PerformanceBadge junto a AgentRating | mismo archivo |

### 4.2 Componente PerformanceBadge

Props:
```
score: number | null
```

Lógica de color:
- `score === null` → no renderizar (retornar null)
- `score >= 90` → color verde (`text-green-500`, `bg-green-500/10`)
- `score >= 70` → color amarillo (`text-yellow-500`, `bg-yellow-500/10`)
- `score < 70` → color rojo (`text-red-500`, `bg-red-500/10`)

Display: `"Performance: {score}/100"`

El componente es `'use client'` con `useTranslations('modelDetail')` para el label "Performance". (Namespace correcto — `models` no existe, `modelDetail` sí.)

### 4.3 Posición en el layout

Junto al `AgentRating` existente — misma fila, separado por un divisor visual (`|` o gap). Debe estar above the fold.

### 4.4 Flujo principal (Happy Path)

1. Usuario o agente abre `/models/:slug`
2. `getModelBySlug` retorna datos con `performance_score: 94.5`
3. Página renderiza `<PerformanceBadge score={94.5} />` → badge verde "Performance: 94.5/100"
4. `<AgentRating />` existente sigue renderizando junto al badge

### 4.5 Flujo de error

- `performance_score === null` (agente nuevo, <5 calls) → `PerformanceBadge` retorna `null` — no se muestra nada, `AgentRating` sigue solo

## 5. Constraint Directives

### OBLIGATORIO
- `'use client'` en `PerformanceBadge.tsx`
- Usar clases Tailwind existentes (no estilos inline)
- `performance_score` puede ser `number | null` — manejar ambos casos
- i18n: label "Performance" vía `useTranslations('modelDetail')` — namespace correcto en messages/en.json

### PROHIBIDO
- NO cambiar `getModelBySlug` ni queries de Supabase
- NO tocar `AgentRating.tsx`
- NO modificar la lógica de `reputation_score` (votos)
- NO añadir dependencias nuevas

## 6. Scope

**IN:**
- Nuevo componente `PerformanceBadge`
- Render del badge en la página del modelo
- Claves i18n `modelDetail.performanceBadge.*` en `messages/en.json` y `messages/es.json`
- Campo `performance_score?: number | null` en `src/features/models/types/models.types.ts`

**OUT:**
- On-chain reputation
- `p50_ms`, `p95_ms`, `error_rate_7d` (datos del endpoint `/reputation`) — Sprint posterior

## 7. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| `performance_score` no viene en los tipos TypeScript del modelo | Media | Medio | Verificar `src/types/` o `Model` type antes de implementar; añadir campo si falta |

## 8. Dependencias
- WAS-213 migración 058 (done) — `performance_score` existe en prod

---

*SDD generado por NexusAgil — FULL*
