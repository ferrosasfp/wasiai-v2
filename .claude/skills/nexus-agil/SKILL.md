---
name: nexus-agil
description: >
  Metodología NexusAgil v1.2 para procesar trabajo con agentes de IA.
  Activar cuando el usuario mencione "NexusAgil", "procesa HU", "sprint planning",
  "adversarial review", "story file", "quality pipeline", o cualquier gate formal.
---

# NexusAgil v1.2 — Instrucciones de Ejecución

> **REGLA #1: Este archivo es un CHECKLIST, no documentación. Cada paso numerado es una INSTRUCCIÓN que DEBO ejecutar. No saltar pasos.**
> **REGLA #2: Si no estoy seguro de qué paso sigue, releer este archivo desde el inicio.**
> **REGLA #3: Las references/ contienen templates y detalles. Este archivo contiene el flujo obligatorio.**

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
3. Dar mi validación adversarial del backlog
4. Esperar: HU_APPROVED
```

### S2 — Escribir SDDs
```
HACER (por cada issue aprobado):
1. Leer el código actual relacionado con el issue
2. *** WAVE 0 — PRE-FLIGHT (OBLIGATORIO) ***
   0.1 — ¿El fix ya existe? (grep/búsqueda) → si existe: ALREADY_IMPLEMENTED
   0.2 — ¿Los archivos referenciados existen? → si no: corregir rutas
   0.3a — ¿El código de referencia compila contra tipos/ABI reales? → si no: corregir
   0.3b — ¿El encoding es correcto? (indexed events = keccak256, structs) → si no: corregir
   0.3c — Para contratos: ¿overflow, reentrancy, front-running? → documentar
   0.4 — ¿Dependencias entre SDDs resueltas? → si no: marcar orden
   0.5 — ¿Hay TODOs o ambigüedades? → completar
3. Escribir SDD con estas secciones OBLIGATORIAS:
   - Context
   - Acceptance Criteria (EARS format)
   - Wave 0 — Pre-flight (instrucciones para sub-agente)
   - Waves 1..N (con build gate al final de cada wave)
   - Rollback (cómo revertir)
   - Critical Constraints
4. Guardar en doc/sdd/NNN-titulo.md
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
1. Lanzar sub-agentes según plan (paralelo o secuencial)
2. En el task de cada sub-agente, INCLUIR ESTA INSTRUCCIÓN:
   "Antes de ejecutar Wave 1, ejecuta Wave 0:
    Lee el SDD completo. Luego verifica:
    1. ¿Los archivos mencionados existen? Lee cada uno.
    2. ¿El código de referencia es compatible con los tipos reales?
    3. ¿El fix ya está implementado?
    4. Ejecuta build gate al final de cada wave (tsc --noEmit o equivalente).
    Si encuentras discrepancias, STOP y reporta. No ejecutes."
3. Esperar resultados
4. Para QUALITY/contratos: ejecutar Security Gate (ver abajo)
```

### S5 — Review
```
HACER:
1. Presentar tabla de resultados: issue, fix, commit, evidencia
2. Incluir hallazgos durante ejecución
3. Esperar: REVIEW_APPROVED
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
1. Presentar Work Item normalizado con ACs EARS
2. Esperar: HU_APPROVED
```

### Q3 — SDD
```
HACER:
1. *** EJECUTAR WAVE 0 COMPLETO (ver S2 arriba) ***
2. Escribir SDD con todas las secciones obligatorias
3. Incluir Constraint Directives (OBLIGATORIO/PROHIBIDO)
4. Incluir Rollback plan
5. Readiness Check (cada AC tiene archivo, cada archivo tiene exemplar)
6. Esperar: SPEC_APPROVED
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
1. Lanzar sub-agente con Story File + instrucción de Wave 0 + build gates
2. Esperar resultado
```

### Q6 — Adversarial Review
```
HACER:
1. Revisar el diff real (no el SDD, el código commiteado)
2. Ejecutar checklist AR (references/adversarial_review_checklist.md)
3. Clasificar: BLOQUEANTE / MENOR / OK
4. Si BLOQUEANTE: sub-agente corrige, re-review
```

### Q7 — Security Gate (si QUALITY o contratos)
```
HACER:
1. ¿El diff introduce nueva superficie de ataque?
2. ¿Se mantiene menor privilegio?
3. ¿Inputs validados?
4. ¿Secrets hardcodeados?
5. ¿Error handling seguro?
Si concern → revert o hotfix SDD
```

### Q8 — QA + Push
```
HACER:
1. Drift detection (esperado vs real)
2. Verificar ACs con evidencia archivo:línea
3. Build + tests pasan
4. Commit + push
5. Actualizar _INDEX.md
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

1. **Wave 0 es OBLIGATORIO** — doble ejecución (yo + sub-agente)
2. **Build gate al final de CADA wave** — no solo al final
3. **Rollback en cada SDD** — sin rollback = SDD incompleto
4. **Gates requieren texto EXACTO** — "sí", "ok", "dale" NO activan gates
5. **No preguntar "¿continúo?" entre fases** — el pipeline avanza solo entre gates
6. **Leer código real antes de generar** — SIEMPRE
7. **Para contratos: verificar encoding** — indexed = keccak256, no string directo
8. **Paralelismo solo con archivos disjuntos** — verificar ANTES
9. **Security Gate para QUALITY** — revisar diff real post-commit
10. **Amendments formales** — no cambios ad-hoc post-SPEC_APPROVED

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

| Archivo | Cuándo leer |
|---------|-------------|
| `references/quality_pipeline.md` | Pipeline QUALITY detallado |
| `references/quick_flow.md` | Pipeline FAST |
| `references/sdd_template.md` | Al escribir un SDD |
| `references/story_file_template.md` | Al generar Story File |
| `references/adversarial_review_checklist.md` | Al hacer AR |
| `references/validation_report_template.md` | Al hacer QA |
| `references/sprint_cadence.md` | Para ceremonias de sprint |
| `references/agents_roster.md` | Roles de cada agente |
| `references/project_context_template.md` | Bootstrap de proyecto nuevo |

---

> **Versión:** 1.2 (marzo 2026)
> **Changelog:** Wave 0 ampliado, doble validación, build gates por wave, rollback obligatorio, amendments, reglas de paralelismo, security gate
