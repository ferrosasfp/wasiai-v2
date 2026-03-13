# Sprint Cadence — NexusAgil

> Un sprint no tiene duración fija. Puede durar una hora o una semana.
> Lo que importa es que las 3 ceremonias ocurran en orden: Planning → Review → Retro.

---

## Las 3 Ceremonias

| Ceremonia | Cuándo | Duración | Objetivo |
|-----------|--------|----------|----------|
| **Planning** | Al abrir el sprint | 5-30 min | Seleccionar HUs, clasificar, estimar |
| **Review** | Al completar la ejecución | 5-15 min | Demo de entregables → REVIEW_APPROVED |
| **Retro** | Después del Review | 5-15 min | Lecciones + acciones → RETRO_APPROVED |

**No hay Status Meeting fijo.** Si el sprint dura 1 hora, no tiene sentido. Si dura 1 semana, el SM puede hacer un checkpoint informal cuando lo necesite.

---

## Planning

### Script de SM

1. **Revisar backlog**: Leer HUs pendientes del PO
2. **Revisar `_INDEX.md`**: Ver velocidad del sprint anterior
3. **Presentar propuesta**:

```markdown
## Sprint Planning — Sprint N

### Sprint anterior
| HUs completadas | Carry-over | Abortadas |
|-----------------|------------|-----------|
| N               | N          | N         |

### Backlog priorizado
| # | HU | Clasificación | Estimación | Sub-agentes |
|---|-----|--------------|-----------|-------------|
| 1 | [título] | QUALITY | L | 6 |
| 2 | [título] | HU-MAJOR | M | 5 |
| 3 | [título] | FAST-FIX | S | 1 |

### Selección propuesta
- [ ] HU: [título] — [clasificación] — [estimación]
- [ ] HU: [título] — [clasificación] — [estimación]
```

4. **Esperar SPRINT_APPROVED del PO**
5. **Ejecutar pipeline** según clasificación

### Estimación de Sizing

| Tamaño | Señales | Clasificación esperada |
|--------|---------|----------------------|
| **S** | 1-3 archivos, sin BD, fix puntual | FAST-FIX |
| **M** | 3-8 archivos, posible BD, lógica moderada | HU-MINOR / HU-MAJOR |
| **L** | 8+ archivos, BD, contratos, múltiples waves | HU-MAJOR / QUALITY |

---

## Review

### Script de SM

1. **Compilar reportes**: build-report, logic-audit, security-review, qa-report de cada HU
2. **Presentar resultados**:

```markdown
## Sprint Review — Sprint N

### Entregables
| # | HU | Estado | Commits | Tests | ACs |
|---|-----|--------|---------|-------|-----|
| NNN | [título] | ✅ DONE | `abc1234` | 173/173 | 5/5 |
| NNN | [título] | ✅ DONE | `def5678` | 173/173 | 3/3 |

### Hallazgos de sub-agentes
| HU | Agente | Hallazgo | Severidad | Acción |
|----|--------|----------|-----------|--------|
| NNN | Logic Auditor | [hallazgo] | MENOR | Documentado |
| NNN | Security Reviewer | [hallazgo] | BLOQUEANTE | Corregido |

### Demo
[Descripción breve de lo que se puede verificar]
```

3. **Esperar REVIEW_APPROVED del PO**

---

## Retro

### Script de SM

1. **Compilar resultados**: Leer `_INDEX.md` y reportes del sprint
2. **Recopilar Auto-Blindaje** de todos los reportes
3. **Presentar retro**:

```markdown
## Retrospectiva — Sprint N

### Resumen
| Métrica | Valor |
|---------|-------|
| HUs completadas | N |
| Carry-over | N |
| Errores atrapados por sub-agentes | N |
| Desviaciones de proceso | N |

### Qué funcionó
- [Aspecto positivo]

### Qué no funcionó
- [Problema y por qué]

### Auto-Blindaje consolidado
| Error | Fix | Aplicar en |
|-------|-----|-----------|
| [error] | [fix] | [dónde] |

### Acciones de mejora
| # | Acción | Responsable |
|---|--------|-------------|
| 1 | [acción concreta] | [quién] |

### Velocidad
- Sprint anterior: N HUs
- Este sprint: N HUs
```

4. **Si un error se repitió**: SM propone agregarlo a `project-context.md`
5. **Esperar RETRO_APPROVED del PO** → Sprint cerrado

---

## Reglas de Cadencia

1. **Sprint = lo que el PO decida.** 1 hora, 1 día, 1 semana. Sin default fijo.
2. **Las 3 ceremonias son obligatorias** (Planning, Review, Retro) pero pueden ser de 5 minutos.
3. **SM no bloquea el pipeline.** Ceremonias son de coordinación, no burocracia.
4. **Velocidad se mide en HUs, no en tiempo.** Un sprint de 2 horas con 6 HUs > un sprint de 1 semana con 2.
5. **Carry-over no es fracaso.** SM documenta por qué.
6. **SM propone, PO decide.** Priorización final siempre del PO.
7. **Checkpoints informales** solo si el sprint dura más de 1 día.
