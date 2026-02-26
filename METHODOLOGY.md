# WasiAI — Pro Methodology
## Nexus Factory × BMAD Method v6

> Metodología de ingeniería de software para productos Web3 de calidad producción.
> Cada fase tiene agentes, herramientas y gates concretos.
> Sin gate aprobado por Fer → no se avanza.

---

## El flujo completo

```
┌─────────────────────────────────────────────────────────────────┐
│  FASE 0 — CONTEXTO (una vez, refrescar en cambios grandes)      │
│  project-context.md → todos los agentes cargan esto primero     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  FASE 1 — DISCOVERY (por feature)                                │
│                                                                  │
│  Idea del BACKLOG                                               │
│    ↓                                                            │
│  [Opcional] /bmad-agent-bmm-analyst → Brainstorm / Brief        │
│    ↓                                                            │
│  S0 → HU + AC + Scope + Riesgos                                 │
│    ↓                                                            │
│  [Si hay decisión técnica grande] → /bmad-agent-bmm-architect   │
│    → ADR documentado en .nexus/docs/architecture/               │
│    ↓                                                            │
│  ⛔ GATE 1: HU_APPROVED: yes  ← Fer aprueba                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  FASE 2 — SPEC (por feature)                                     │
│                                                                  │
│  S1 → SDD (rutas, schema, on-chain, UI, flujos, DoD)            │
│    ↓                                                            │
│  /bmad-bmm-check-implementation-readiness                        │
│    → ¿Están todas las dependencias listas?                      │
│    → ¿El SDD es implementable sin ambigüedad?                   │
│    ↓                                                            │
│  ⛔ GATE 2: SPEC_APPROVED: yes  ← Fer aprueba                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  FASE 3 — IMPLEMENTACIÓN (por feature)                           │
│                                                                  │
│  S2 → Golden Path estricto                                       │
│    ↓                                                            │
│  Tests unitarios junto al código (Vitest)                        │
│    ↓                                                            │
│  [Antes del commit] /bmad-review-adversarial-general             │
│    → Revisión desde la perspectiva del adversario               │
│    → Busca: hardcodes, race conditions, auth bypass, SSRF       │
│    ↓                                                            │
│  Si algo falla → /bmad-bmm-correct-course                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  FASE 4 — VALIDACIÓN (por feature)                               │
│                                                                  │
│  /bmad-agent-bmm-qa → tests E2E desde el SDD                    │
│  npm run build → 0 errores TS, 0 warnings ESLint                 │
│  forge test → 59/59 si hubo cambio en contrato                  │
│  DoD checklist completo                                          │
│  git push origin master master:main                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  CADENCIA SEMANAL                                                │
│                                                                  │
│  Lunes    → /bmad-bmm-sprint-planning  (3 stories de la semana) │
│  Miércoles → /bmad-bmm-sprint-status   (check de progreso)      │
│  Viernes  → /bmad-bmm-retrospective    (qué funcionó, qué no)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Fase 0 — Contexto del proyecto

**Cuándo ejecutar:** una vez al inicio, y cuando haya cambios grandes (nuevo contrato, nueva épica, cambio de stack).

**Cómo:**
```
/bmad-bmm-generate-project-context
```
Genera y actualiza `project-context.md` con todo el contexto necesario para que los agentes trabajen sin preguntas repetitivas.

**Regla:** cualquier agente BMAD debe leer `project-context.md` antes de operar.

---

## Fase 1 — Discovery

### Cuándo usar el Analyst completo
- La idea es vaga o necesita investigación de mercado
- Hay múltiples formas de abordar el problema
- No se sabe bien quién es el usuario o qué necesita

```
/bmad-agent-bmm-analyst
→ BP (Brainstorm) o CB (Create Brief) según el caso
```

### Cuándo ir directo a S0
- La HU ya está definida en el BACKLOG con suficiente claridad
- Solo necesita refinamiento de ACs y scope

```
"S0 — [nombre de la HU]"
→ yo activo el skill S0 y elicito lo que falta
```

### Cuándo activar el Architect
- La feature requiere un cambio de arquitectura (nuevo contrato, nueva tabla crítica, nuevo patrón)
- Hay dos o más opciones técnicas válidas que necesitan ser pesadas
- La decisión tiene impacto permanente (ADR)

```
/bmad-agent-bmm-architect
→ CA (Create Architecture) — documenta el ADR
→ se guarda en .nexus/docs/architecture/ADR-XXX.md
```

---

## Fase 2 — Spec

### SDD Generator (S1)
Siempre. Sin excepción.

```
"S1 — [pega la HU aprobada]"
```

### Implementation Readiness Check
Después de que el SDD esté escrito, antes de que Fer lo apruebe:

```
/bmad-bmm-check-implementation-readiness
```

Verifica:
- ¿Todas las dependencias (otras HUs, migrations, contratos) están listas?
- ¿El SDD es implementable sin ambigüedades?
- ¿Los criterios de aceptación son verificables?
- ¿Hay open questions sin resolver?

---

## Fase 2.5 — Story File (OBLIGATORIO, no saltear)

### SM: Create Story
Antes de tocar código, el Scrum Master genera un story file por cada HU:

```
/bmad-agent-bmm-sm → CS (Create Story)
→ genera: .nexus/docs/sdd/story-HU-X.X.md
```

El story file es **autocontenido**: ACs verificables, schema exacto, rutas, patrones del codebase, DoD checklist. El Dev puede implementar desde ese archivo sin contexto adicional.

**Sin story file aprobado → no se empieza a codear.**

---

## Fase 3 — Implementación

### Dev: Dev Story
```
/bmad-agent-bmm-dev → DS (Dev Story) → lee story-HU-X.X.md → implementa
```

### Orden de implementación (siempre este orden)
1. Migration de DB (si hay cambio de schema)
2. Cambio de contrato + forge tests (si hay cambio on-chain)
3. Backend (routes, services, lógica)
4. Frontend (components, hooks, pages)
5. Tests unitarios (Vitest)
6. Adversarial review

### Adversarial Review (antes de cada commit)
```
/bmad-review-adversarial-general
```
Busca activamente:
- Hardcodes de addresses, keys, amounts
- Auth bypass o elevación de privilegios
- Race conditions en operaciones financieras
- SSRF en endpoints con URLs del usuario
- Datos simulados o mocks en paths de producción
- Violaciones al Golden Path

### Course Correction
Si la implementación se desvía del SDD o algo no cuadra:
```
/bmad-bmm-correct-course
```
Diagnostica qué pasó y propone el camino de regreso al SDD. No continúes implementando si algo no coincide — para, usa correct-course.

---

## Fase 4 — Validación

### QA — Tests E2E
```
/bmad-agent-bmm-qa
→ QA (Generate E2E Tests) desde el SDD aprobado
```
Los tests se basan en los criterios de aceptación del SDD. No en lo que se implementó — en lo que se especificó.

### Checklist final (obligatorio antes de push)
```
[ ] forge test → todos pasan (si hubo cambio de contrato)
[ ] npm run build → 0 errores TS, 0 warnings ESLint
[ ] Sin ethers.js imports
[ ] Sin permissionless imports
[ ] Sin hardcodes (addresses, keys, amounts)
[ ] Sin NEXT_PUBLIC_ para secrets
[ ] Sin datos simulados en producción
[ ] RLS verificado en tablas nuevas
[ ] Adversarial review pasado
[ ] DoD del SDD: todos los items marcados
[ ] git push origin master master:main
```

---

## Cadencia semanal

### Lunes — Sprint Planning
```
/bmad-bmm-sprint-planning
```
Define las 3 historias de la semana desde el BACKLOG priorizado. Establece criterios de éxito claros.

### Miércoles — Sprint Status
```
/bmad-bmm-sprint-status
```
¿Qué está hecho? ¿Qué está bloqueado? ¿El ritmo es realista?

### Viernes — Retrospectiva
```
/bmad-bmm-retrospective
```
¿Qué funcionó? ¿Qué no? ¿Qué cambiamos la próxima semana?

---

## Cuándo usar Party Mode
```
/bmad-party-mode
```
Múltiples agentes (Analyst + Architect + PM) discuten un problema simultáneamente. Útil cuando:
- Hay una decisión de producto con múltiples dimensiones (negocio + técnica + UX)
- Estás evaluando si una épica es viable antes de arrancarla
- Necesitas perspectivas contradictorias para validar una decisión

---

## Referencias rápidas

| Necesito... | Comando |
|-------------|---------|
| Explorar una idea vagamente | `/bmad-agent-bmm-analyst` → BP |
| Investigar el mercado | `/bmad-agent-bmm-analyst` → MR |
| Crear HU desde una idea clara | `"S0 — [idea]"` |
| Documentar decisión técnica | `/bmad-agent-bmm-architect` → CA |
| Generar SDD | `"S1 — [HU aprobada]"` |
| Verificar que el SDD es implementable | `/bmad-bmm-check-implementation-readiness` |
| Implementar siguiendo Golden Path | `"S2 — implementa [SDD]"` |
| Revisión adversarial antes de commit | `/bmad-review-adversarial-general` |
| Retomar cuando algo se desvió | `/bmad-bmm-correct-course` |
| Generar tests E2E | `/bmad-agent-bmm-qa` |
| Decisión multi-agente compleja | `/bmad-party-mode` |
| Actualizar contexto del proyecto | `/bmad-bmm-generate-project-context` |
| Planificación semanal | `/bmad-bmm-sprint-planning` |

---

## Archivos de la metodología

```
METHODOLOGY.md              ← este archivo (manual completo)
project-context.md          ← contexto que cargan todos los agentes
CLAUDE.md                   ← contexto rápido para el agente de desarrollo
BACKLOG.md                  ← épicas y HUs priorizadas

.nexus/
├── skills/
│   ├── S0-idea-to-hu.md    ← Analyst adaptado para WasiAI
│   ├── S1-hu-to-sdd.md     ← SDD Generator con contexto técnico
│   └── S2-sdd-to-impl.md   ← Checklist de implementación
├── workflows/
│   ├── golden-path.md      ← Stack inmutable WasiAI
│   └── nexus-bmad-flow.md  ← Flujo completo
└── docs/
    ├── prd/                ← HUs aprobadas
    ├── sdd/                ← SDDs aprobados
    └── architecture/       ← ADRs

_bmad/                      ← BMAD Method v6 (agentes y workflows reales)
```

---

---

## Modelo de ejecución con sub-agentes (regla permanente desde 2026-02-26)

### San es la orquestadora — los sub-agentes son los roles BMAD

San NO genera HUs, SDDs, story files ni hace code review directamente.
San coordina el flujo, mantiene el contexto y hace los gates con Fer.
Cada fase la ejecuta un sub-agente con su rol específico del directorio `_bmad/bmm/agents/`.

### Flujo de sub-agentes por fase

```
FASE 1 — Discovery
  San lanza → sub-agente PM (_bmad/bmm/agents/pm.md) → genera S0 (HU + ACs + Scope + Riesgos)
  Fer → HU_APPROVED
  [Si hay decisión técnica compleja]
  San lanza → sub-agente Architect (_bmad/bmm/agents/architect.md) → ADR

FASE 2 — Spec
  San lanza → sub-agente PM (_bmad/bmm/agents/pm.md) → genera S1 (SDD completo)
  San ejecuta → Implementation Readiness Check (formal, no mental)
  Fer → SPEC_APPROVED

FASE 2.5 — Story File
  San lanza → sub-agente SM (_bmad/bmm/agents/sm.md) → genera story-HU-X.X.md

FASE 3 — Implementación
  San lanza → sub-agente Dev (_bmad/bmm/agents/dev.md) → implementa desde story file

FASE 3.5 — Adversarial Review
  San lanza → sub-agente AR (rol adversarial explícito) → busca problemas reales

FASE 3.6 — Code Review
  San lanza → sub-agente CR (rol reviewer explícito) → revisa calidad y consistencia

FASE 4 — QA
  San lanza → sub-agente QA (_bmad/bmm/agents/qa.md) → verifica cada AC del story file

Push → solo si QA aprueba todos los ACs
```

### Regla de oro
San NUNCA mezcla roles. Si está orquestando, no implementa.
Si un sub-agente implementa, San no revisa — lanza otro sub-agente para eso.

### Golden Path — obligatorio para TODOS los sub-agentes

Cada sub-agente (PM, Architect, Dev, SM, QA, AR, CR) debe:
1. Leer `project-context.md` antes de operar
2. Respetar el stack inmutable de Nexus Factory sin excepciones:
   - Web2: Next.js 14 · Supabase · Tailwind · next-intl · Upstash Redis
   - Web3: Avalanche C-Chain · Solidity 0.8.24 · Foundry · viem v2 · wagmi v3
   - Pagos: x402 + ERC-3009 · uvd-x402-sdk
3. Nunca proponer ni implementar:
   - ethers.js (usar viem)
   - NEXT_PUBLIC_ para secrets o API keys
   - Hardcodes de addresses, amounts o URLs
   - Datos simulados en rutas de producción
   - permissionless / ERC-4337 (removido del stack)
4. El Dev siempre implementa en este orden:
   Migration DB → Contrato + forge tests → Backend → Frontend → Tests unitarios
5. Cualquier violación al Golden Path es BLOQUEANTE en el AR

El Golden Path no es negociable. Ningún sub-agente puede proponer alternativas
al stack sin pasar por el agente Architect y documentar un ADR.

### Archivos de referencia de cada agente
- PM: `_bmad/bmm/agents/pm.md`
- Architect: `_bmad/bmm/agents/architect.md`
- Dev: `_bmad/bmm/agents/dev.md`
- SM: `_bmad/bmm/agents/sm.md`
- QA: `_bmad/bmm/agents/qa.md`
- UX: `_bmad/bmm/agents/ux-designer.md`

---

*Metodología diseñada para WasiAI por San + Fer — 2026-02-25*
*Modelo de sub-agentes por roles BMAD añadido — 2026-02-26*
*BMAD Method v6 + Nexus Factory — producción real, no hackathon*
