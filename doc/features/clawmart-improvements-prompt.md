# Instrucción: Implementación de Mejoras de Producto — WasiAI v2

## Contexto

Basado en un análisis competitivo de ClawMart (marketplace de AI skills con $80k revenue en 30 días), se diseñaron 7 mejoras para WasiAI. Cada mejora tiene su solución técnica detallada en el guide.

## Documentos Obligatorios — Lee ANTES de tocar código

1. 📄 `doc/features/clawmart-improvements-technical-guide.md`
   → Soluciones técnicas detalladas para las 7 mejoras. Incluye:
   - Migraciones SQL completas
   - Código de componentes React
   - Endpoints API con Zod validation
   - Queries Supabase
   - Keys i18n (EN + ES)
   - Patrones transversales a respetar

2. 📄 `CLAUDE.md` + `project-context.md`
   → Golden path, stack, reglas inmutables del proyecto

3. 📄 `.claude/skills/nexus-agil/SKILL.md`
   → Metodología NexusAgile

Lee los 3 documentos COMPLETOS antes de escribir código.

## Golden Path — Reglas que NUNCA se rompen

- **i18n obligatorio**: Toda string visible → key en `messages/en.json` + `messages/es.json` via next-intl
- **Zod en inputs**: Todos los endpoints validan con Zod
- **RLS activo**: Toda tabla nueva con `ENABLE ROW LEVEL SECURITY` + policies
- **ISR/revalidate**: Páginas públicas → `export const revalidate = 300`
- **Feature-first**: Componentes en `src/features/[feature]/components/`
- **createClient()**: En pages y Server Components. `createServiceClient()` SOLO en cron/admin
- **Fire-and-forget**: DB logging no bloquea response
- **Atomic money**: Operaciones de dinero con RPC atómicos (patrón `check_and_deduct_budget`)
- **Sin hardcodes**: Addresses, URLs, keys → env vars
- **viem v2**: Sin ethers.js

## Metodología NexusAgile

Lee `.claude/skills/nexus-agil/SKILL.md` para el flujo completo.

## Plan de Ejecución

### FASE 1 — FAST (sin HU, ejecución directa)

| # | Mejora | Guide Section | Archivos | Esfuerzo |
|---|---|---|---|---|
| 1 | **Free Trial visible en marketplace** — badge en cards + sección "Free to Try" + filtro | Mejora 1 | 3 archivos | ~2h |
| 2 | **Social Proof** — total_calls en cards + secciones Trending/Top Rated/New + badges | Mejora 2 | 3-4 archivos + 1 migración | ~3h |

Para cada FAST:
1. Lee la sección correspondiente en `clawmart-improvements-technical-guide.md`
2. Haz Codebase Grounding (lee archivos reales antes de modificar)
3. Implementa respetando golden path
4. Agrega keys i18n en AMBOS idiomas (en.json + es.json)
5. Verifica: `npm run build`
6. Commit descriptivo

### FASE 2 — QUALITY HUs (flujo completo NexusAgile)

Para cada HU QUALITY, sigue el flujo completo:
1. Lee la solución detallada en `clawmart-improvements-technical-guide.md`
2. F0: Codebase Grounding — lee archivos reales mencionados en el guide
3. F1: Work Item con ACs EARS basados en la solución del guide
4. ⛔ HU_APPROVED
5. F2: SDD con Constraint Directives
6. ⛔ SPEC_APPROVED
7. F2.5: Story File
8. F3: Implementación con Anti-Hallucination
9. AR: Adversarial Review
10. F4: QA con evidencia archivo:línea

**Prioridad 1:**

| HU | Mejora | Descripción | Guide Section |
|---|---|---|---|
| HU-CM-01 | **Collections** | Tabla collections + página /collections/[slug] + index + featured en landing + navbar link | Mejora 3 |
| HU-CM-02 | **Agent-to-Agent Discovery** | Endpoint /api/v1/agents/discover + métricas A2A en transparency + narrative section en landing | Mejora 4 |

**Prioridad 2:**

| HU | Mejora | Descripción | Guide Section |
|---|---|---|---|
| HU-CM-03 | **Creator CLI** | `wasiai publish` + `wasiai stats` + `wasiai discover` en repo wasiai-sdk | Mejora 5 |
| HU-CM-04 | **Skills Marketplace** | Tabla skills + SkillCard + publish flow + tabs en marketplace + detail page | Mejora 6 |

**Prioridad 3:**

| HU | Mejora | Descripción | Guide Section |
|---|---|---|---|
| HU-CM-05 | **Bounties** | Tabla bounties + UI + escrow integration + submissions flow | Mejora 7 |

## Checklist por Mejora

### Para mejoras con migraciones SQL:
1. Crear archivo en `supabase/migrations/` con naming `NNN_description.sql`
2. Incluir `ENABLE ROW LEVEL SECURITY` en toda tabla nueva
3. Incluir policies de lectura pública + escritura scoped a usuario
4. Incluir índices para queries frecuentes

### Para mejoras con UI:
1. Componentes en `src/features/[feature]/components/`
2. Pages en `src/app/[locale]/[route]/page.tsx`
3. Toda string → key i18n en `messages/en.json` + `messages/es.json`
4. Seguir patrón de ModelCard.tsx (memoized, lazy loading)
5. Responsive: mobile-first con grid breakpoints sm/lg

### Para mejoras con endpoints API:
1. Zod schema para input validation
2. Rate limiting (reutilizar getInvokeLimit o crear nuevo)
3. Error responses consistentes: `{ error: string, details?: unknown }`
4. `createClient()` para queries RLS-safe

### Para mejoras en el SDK (wasiai-sdk):
1. El repo está en `https://github.com/ferrosasfp/wasiai-sdk`
2. Seguir patrón existente de `invoke` command
3. CLI con `commander` library
4. TypeScript estricto

## Reglas de Implementación

1. **El guide técnico es REFERENCIA, no copy-paste.** Adapta al código actual.
2. **Anti-Hallucination:** Lee el archivo REAL antes de modificarlo.
3. **i18n SIEMPRE en ambos idiomas.** Si no sabes la traducción, pon la key y marca con `// TODO: translate`.
4. **Si un fix rompe build, REVIERTE y escala.**
5. **Tests:** Si el proyecto tiene tests relevantes, verificar que siguen pasando.
6. **Después de TODOS los cambios:**
   - `npm run build`
   - `npm run typecheck`
   - `npm run lint` (si disponible)

## Resultado Esperado

Al terminar FASE 1:
- Badge "Free Trial" visible en agent cards
- Sección "Free to Try" en landing
- total_calls visible en cards
- Secciones Trending/Top Rated/New en landing
- Build pasando
- i18n en EN + ES

Al terminar cada HU de FASE 2:
- Story file en `doc/sdd/cm-XX/`
- Código implementado y verificado
- AR report
- QA report con evidencia archivo:línea
- Migración SQL aplicable
- i18n completo en EN + ES
