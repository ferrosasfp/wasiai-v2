# Sprint 5 — Backlog

> Fecha: 2026-03-14 | SM: San

## Issues seleccionados

| # | Issue | Título | Clasificación | Dependencias |
|---|-------|--------|--------------|-------------|
| 1 | F-02 | DNS rebinding en health-probe | FAST-FIX | ninguna |
| 2 | F-03 | probeEndpoint usa SERVICE_ROLE | FAST-FIX | ninguna |
| 3 | WAS-191 | performance_score visible en perfil UI | HU-MINOR | WAS-213 (done) |
| 4 | WAS-199 | /reputation incluye performance_score + erc8004 básico | HU-MAJOR | WAS-213 (done) |
| 5 | WAS-187 | discoverAgent rankea por performance_score (no reputation_score) | QUALITY | WAS-213 (done) |

## Orden de ejecución

- **Paralelo Wave 1:** F-02, F-03, WAS-191 (archivos disjuntos)
- **Secuencial Wave 2:** WAS-199 (después de confirmar /reputation endpoint)
- **Wave 3:** WAS-187 (toca agent-discovery.ts + compose/route.ts)

## Estado real del código (pre-sprint)

### F-02 — DNS rebinding
- Archivo: `src/lib/agents/health-probe.ts`
- Problema: `fetch(endpointUrl)` sin resolver IP primero — DNS rebinding attack posible
- Fix: resolver hostname → validar IP no es RFC1918 → fetch via IP con Host header

### F-03 — SERVICE_ROLE en probe
- Archivo: `src/lib/agents/health-probe.ts` línea 5, 20
- `createServiceClient()` usado para escribir en `agents` table — bypassa RLS
- Decisión: by design (probe necesita escribir sin sesión), documentar con comentario explícito
- Fix: añadir comentario SECURITY_NOTE explicando por qué es necesario

### WAS-191 — performance_score en perfil UI
- Archivo: `src/app/[locale]/models/[slug]/page.tsx`
- Actualmente muestra: `AgentRating` (votos UP/DOWN) + `reputation_score`
- Gap: no muestra `performance_score` (WAS-213) ni datos del endpoint `/reputation` (latencia, error rate)
- Fix: añadir badge/card con performance_score + p50/p95 si disponibles

### WAS-199 — /reputation endpoint gaps
- Archivo: `src/app/api/v1/agents/[slug]/reputation/route.ts`
- Existe y funciona. Gaps:
  1. No incluye `performance_score` (WAS-213) en el response
  2. `erc8004_score: null` — placeholder sin valor real
  3. No incluye `reputation_score` (votos) para diferenciarlo de performance
  4. AC-1 original pide campo `format_compliance_pct` — no implementado

### WAS-187 — discoverAgent ranking
- Archivo: `src/lib/agent-discovery.ts`
- Actualmente: ordena por `reputation_score` (votos subjetivos, frecuentemente null)
- Fix: ordenar por `performance_score` DESC, luego `reputation_score` DESC, luego `price_per_call` ASC
- También: `constraints.min_reputation` filtra por `reputation_score` — debería filtrar `performance_score`
