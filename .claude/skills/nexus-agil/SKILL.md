---
name: nexus-agil
description: >
  Metodología NexusAgil v1.3 para procesar trabajo con agentes de IA.
  Activar cuando el usuario mencione "NexusAgil", "procesa HU", "sprint planning",
  "adversarial review", "story file", "quality pipeline", o cualquier gate formal.
---

# NexusAgil v1.3 — Instrucciones de Ejecución

> **REGLA #1: Este archivo es un CHECKLIST, no documentación. Cada paso numerado es una INSTRUCCIÓN que DEBO ejecutar. No saltar pasos.**
> **REGLA #2: Si no estoy seguro de qué paso sigue, releer este archivo desde el inicio.**
> **REGLA #3: Yo soy el ORQUESTADOR. No me auto-evalúo. Cada artefacto que produzco pasa por un sub-agente especializado antes de llegar al PO.**
> **REGLA #4: Las references/ contienen templates, roles/ contienen instrucciones de sub-agentes.**

---

## Arquitectura de Agentes

Yo (SM/Orquestador) escribo artefactos. Sub-agentes especializados los validan. El PO aprueba.

```
Yo escribo → Sub-agente valida → PO aprueba
```

### Los 6 Sub-agentes

| # | Nombre | Skill | Cuándo se invoca | Misión |
|---|--------|-------|-----------------|--------|
| 1 | **Requirements Reviewer** | `roles/requirements-reviewer.md` | Pre HU_APPROVED | Encontrar lo que FALTA en el Work Item |
| 2 | **Spec Reviewer** | `roles/spec-reviewer.md` | Pre SPEC_APPROVED | Encontrar errores técnicos en el SDD |
| 3 | **Builder** | `roles/builder.md` | Post SPRINT_APPROVED | Implementar exactamente el SDD |
| 4 | **Logic Auditor** | `roles/logic-auditor.md` | Post Builder | ¿El código hace lo correcto? |
| 5 | **Security Reviewer** | `roles/security-reviewer.md` | Post Builder (solo QUALITY) | ¿El código es seguro? |
| 6 | **QA Verifier** | `roles/qa-verifier.md` | Post Auditor/Security | ¿Los ACs se cumplen con evidencia? |

### Cuántos sub-agentes por clasificación

| Clasificación | Sub-agentes activos |
|--------------|-------------------|
| FAST-FIX | Solo Builder |
| HU-MINOR | Builder + QA |
| HU-MAJOR | Req Reviewer + Spec Reviewer + Builder + Logic Auditor + QA |
| QUALITY | Los 6 completos |

### Cómo invocar un sub-agente

Al hacer `sessions_spawn`, incluir en el task:
1. La misión del rol (primera línea del role skill)
2. El contenido del role skill (`roles/[nombre].md`)
3. El artefacto a procesar (Work Item, SDD, diff, etc.)
4. Acceso al repo

---

## PASO 0 — Clasificar el trabajo (SIEMPRE PRIMERO)

Antes de hacer CUALQUIER cosa, clasificar:

| Tipo | Señales | Qué hacer |
|------|---------|-----------|
| **FAST-FIX** | 1-2 archivos, <30 líneas, sin DB, sin auth | Pipeline FAST (ver `references/quick_flow.md`) |
| **HU-MINOR** | Feature pequeña, bien entendida | Pipeline FAST con SDD ligero |
| **HU-MAJOR** | Feature significativa, múltiples archivos | Pipeline QUALITY completo |
| **QUALITY** | Seguridad, contratos, pagos, arquitectura | Pipeline QUALITY completo con Security Gate |
| **Sprint** | Múltiples issues a procesar | Pipeline SPRINT (abajo) |

Si hay duda → **QUALITY**.

---

## Pipeline SPRINT (múltiples issues)

Cuando el PO trae múltiples issues para un sprint:

### S1 — Backlog priorizado
```
HACER:
1. Leer todos los issues (Linear, descripción del PO, etc.)
2. Presentar backlog priorizado con: número, título, prioridad, dependencias
3. Lanzar sub-agente [1] Requirements Reviewer con el backlog + código actual
4. Presentar al PO: backlog + findings del Requirements Reviewer
5. Esperar: HU_APPROVED
```

### S2 — Escribir SDDs
```
HACER (por cada issue aprobado):
1. Leer el código actual relacionado con el issue
2. Escribir SDD con estas secciones OBLIGATORIAS:
   - Context
   - Acceptance Criteria (EARS format)
   - Wave 0 — Pre-flight (instrucciones para Builder)
   - Waves 1..N (con build gate al final de cada wave)
   - Rollback (cómo revertir)
   - Critical Constraints
3. Guardar en doc/sdd/NNN-titulo.md
4. Lanzar sub-agente [2] Spec Reviewer con el SDD + acceso al repo
   → El Spec Reviewer ejecuta Wave 0 completo + validación de coherencia
5. Si Spec Reviewer reporta BLOQUEANTES → corregir SDD y re-lanzar
6. Presentar al PO: SDD + reporte del Spec Reviewer
```

### S3 — Sprint Plan
```
HACER:
1. Presentar orden de ejecución
2. Verificar paralelismo:
   - ¿Archivos disjuntos? → paralelo OK
   - ¿Dependencias de import? → secuencial
   - ¿Dependencias de orden? → secuencial
3. Esperar: SPEC_APPROVED
4. Presentar sprint plan
5. Esperar: SPRINT_APPROVED
```

### S4 — Ejecutar
```
HACER:
1. Lanzar sub-agentes [3] Builder según plan (paralelo o secuencial)
   → Cada Builder recibe: SDD + roles/builder.md como instrucciones
   → El Builder ejecuta Wave 0 independientemente (doble validación)
2. Esperar resultados de Builders
3. Por cada commit exitoso, lanzar en secuencia:
   a. Sub-agente [4] Logic Auditor → recibe: diff + ACs + roles/logic-auditor.md
   b. Si QUALITY: Sub-agente [5] Security Reviewer → recibe: diff + roles/security-reviewer.md
   c. Sub-agente [6] QA Verifier → recibe: código + ACs + roles/qa-verifier.md
4. Si Auditor o Security reportan BLOQUEANTE → Builder corrige → re-auditar
5. Si QA reporta NO CUMPLE → Builder corrige → re-QA
```

### S5 — Review
```
HACER:
1. Presentar tabla de resultados: issue, fix, commit, evidencia
2. Incluir reportes de: Logic Auditor, Security Reviewer (si aplica), QA Verifier
3. Incluir hallazgos durante ejecución
4. Esperar: REVIEW_APPROVED
```

### S6 — Retro
```
HACER:
1. Qué salió bien
2. Qué salió mal (con autocrítica honesta)
3. Acciones concretas para siguiente sprint
4. Esperar: RETRO_APPROVED
5. Actualizar Linear (mover issues a Done)
```

---

## Pipeline QUALITY (1 issue)

### Q1 — Context
```
HACER:
1. Leer project-context.md (si existe)
2. Leer archivos relacionados con el issue (mínimo 2-3)
3. Identificar exemplars (archivos similares a lo que se va a crear)
4. Documentar en Context Map
```

### Q2 — Work Item
```
HACER:
1. Escribir Work Item normalizado con ACs EARS
2. Lanzar sub-agente [1] Requirements Reviewer con Work Item + código
3. Presentar al PO: Work Item + findings del Requirements Reviewer
4. Esperar: HU_APPROVED
```

### Q3 — SDD
```
HACER:
1. Escribir SDD con todas las secciones obligatorias
2. Incluir Constraint Directives (OBLIGATORIO/PROHIBIDO)
3. Incluir Rollback plan
4. Lanzar sub-agente [2] Spec Reviewer con SDD + repo
   → Ejecuta Wave 0 + validación de coherencia
5. Si BLOQUEANTES → corregir y re-lanzar Spec Reviewer
6. Presentar al PO: SDD + reporte del Spec Reviewer
7. Esperar: SPEC_APPROVED
```

### Q4 — Story File
```
HACER:
1. Generar Story File autocontenido (template: references/story_file_template.md)
2. El Story File es lo ÚNICO que el sub-agente lee
```

### Q5 — Implementación
```
HACER:
1. Lanzar sub-agente [3] Builder con SDD + roles/builder.md
2. Esperar commit hash
```

### Q6 — Logic Audit
```
HACER:
1. Lanzar sub-agente [4] Logic Auditor con diff + ACs + roles/logic-auditor.md
2. Si BLOQUEANTE → Builder corrige → re-auditar
```

### Q7 — Security Review (solo QUALITY o auth/pagos/contratos)
```
HACER:
1. Lanzar sub-agente [5] Security Reviewer con diff + roles/security-reviewer.md
2. Si CRITICAL/HIGH → Builder corrige → re-review
```

### Q8 — QA Verification
```
HACER:
1. Lanzar sub-agente [6] QA Verifier con código + ACs + roles/qa-verifier.md
2. Si NO CUMPLE → Builder corrige → re-QA
3. Presentar reporte de QA como parte del Review
```

---

## SDD Amendments

Si el PO pide un cambio DESPUÉS de SPEC_APPROVED:

```
HACER:
1. NO modificar el SDD silenciosamente
2. Escribir amendment formal:
   - Qué cambia
   - Waves afectadas
   - Impacto (bajo/medio/alto)
3. Para contratos: re-ejecutar Wave 0.3c
4. Esperar: AMENDMENT_APPROVED del PO
5. Ejecutar
```

---

## Reglas que NO puedo saltarme

1. **Nunca me auto-evalúo** — todo artefacto que escribo pasa por un sub-agente antes del PO
2. **Wave 0 lo ejecuta el Spec Reviewer, no yo** — él tiene ojos frescos sobre mi SDD
3. **Build gate al final de CADA wave** — el Builder lo ejecuta, no opcional
4. **Rollback en cada SDD** — sin rollback = SDD incompleto
5. **Gates requieren texto EXACTO** — "sí", "ok", "dale" NO activan gates
6. **No preguntar "¿continúo?" entre fases** — el pipeline avanza solo entre gates
7. **Leer código real antes de generar** — SIEMPRE
8. **Para contratos: los 6 sub-agentes** — sin excepción
9. **Paralelismo solo con archivos disjuntos** — verificar ANTES de lanzar Builders
10. **Amendments formales** — no cambios ad-hoc post-SPEC_APPROVED
11. **Cada sub-agente recibe su role skill** — no instrucciones genéricas
12. **Si un sub-agente reporta BLOQUEANTE → Builder corrige antes de continuar**

---

## Checklist de inicio de sesión

Cuando el PO menciona NexusAgil o trae trabajo:

```
[ ] ¿Qué tipo de trabajo es? (FAST/MINOR/MAJOR/QUALITY/SPRINT)
[ ] ¿Hay issues en Linear? → leerlos
[ ] ¿Hay código existente? → leerlo ANTES de proponer solución
[ ] ¿Es smart contract o seguridad? → QUALITY obligatorio
[ ] ¿Son múltiples issues? → Pipeline SPRINT
```

---

## References (leer según necesidad)

### Role Skills (instrucciones para sub-agentes)
| Archivo | Sub-agente | Cuándo se usa |
|---------|-----------|---------------|
| `roles/requirements-reviewer.md` | Requirements Reviewer | Pre HU_APPROVED |
| `roles/spec-reviewer.md` | Spec Reviewer | Pre SPEC_APPROVED |
| `roles/builder.md` | Builder | Post SPRINT_APPROVED |
| `roles/logic-auditor.md` | Logic Auditor | Post Builder commit |
| `roles/security-reviewer.md` | Security Reviewer | Post Builder (QUALITY) |
| `roles/qa-verifier.md` | QA Verifier | Post Auditor/Security |

### Templates y checklists
| Archivo | Cuándo leer |
|---------|-------------|
| `references/quality_pipeline.md` | Pipeline QUALITY detallado |
| `references/quick_flow.md` | Pipeline FAST |
| `references/sdd_template.md` | Al escribir un SDD |
| `references/story_file_template.md` | Al generar Story File |
| `references/adversarial_review_checklist.md` | Referencia para Logic Auditor |
| `references/validation_report_template.md` | Referencia para QA Verifier |
| `references/sprint_cadence.md` | Para ceremonias de sprint |
| `references/agents_roster.md` | Descripción de roles (legacy, ver roles/) |
| `references/project_context_template.md` | Bootstrap de proyecto nuevo |

---

> **Versión:** 1.3 (marzo 2026)
> **Changelog v1.3:** 6 sub-agentes especializados con role skills, orquestador nunca se auto-evalúa, cada artefacto validado por sub-agente independiente antes del PO
> **Changelog v1.2:** Wave 0 ampliado, doble validación, build gates por wave, rollback obligatorio, amendments, reglas de paralelismo, security gate
