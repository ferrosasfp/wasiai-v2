# Sprint Report — Free Trial: Sandbox + A2A + Zero Duplicación

> Fecha: 2026-03-23
> Clasificación: HU-MAJOR → reclasificado HU-MINOR (80% ya existía)
> Pipeline: QUALITY (Req Reviewer + Spec Reviewer + Builder + Logic Auditor + QA)

## Commits
| Hash | Descripción |
|------|-------------|
| `bc7465938` | feat(invoke): remove Route C, add sandbox shortcut, enrich 402 with free_trial info |
| `d29af0975` | feat(trial): A2A native body, sandbox mode, early sandbox detection before Zod |
| `d981c4655` | fix(trial+invoke): null deref cuando sandbox_enabled=false + service client para sandbox log |

**Neto: -20 líneas** (71 ins, 91 del) — 2 archivos tocados.

## Retro

### Qué salió bien
- Pipeline NexusAgil detectó 4+3+1 = **8 problemas** antes de llegar a producción
- El bug crítico (null deref) habría crasheado en prod con cualquier request `X-Sandbox: true` a un agente sin sandbox
- Reclasificación a HU-MINOR fue correcta — evitó sobre-engineering
- La decisión de eliminar duplicación (Opción A) fue rápida y limpia

### Qué salió mal
- Route C se implementó esta misma tarde sin revisar que ya existía `/trial` — duplicación evitable con 5 min de exploración
- El SDD original tenía 3 bloqueantes que el Spec Reviewer encontró — debo leer el código más a fondo antes de escribir SDDs
- El campo `metadata.example_output` no existe (es `input_example`) — asumí un nombre sin verificar la DB

### Acciones para siguiente sprint
1. **Antes de escribir cualquier código nuevo:** grep el codebase por funcionalidad similar existente
2. **Antes de referenciar campos DB:** verificar con query real, no asumir nombres
3. **Sandbox mode UX:** configurar `metadata.example_output` en los blexsignal agents para que sandbox devuelva datos reales (ahora devuelve `{ pairs: [] }` que es el input_example)
