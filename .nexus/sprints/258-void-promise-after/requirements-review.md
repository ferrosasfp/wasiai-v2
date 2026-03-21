# Requirements Review — WAS-258 — void Promise → after() (QUALITY)

**Fecha:** 2026-03-20
**Reviewer:** Requirements Reviewer — NexusAgil v1.3

---

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F1 | Código actual | ALTA | La instancia #2 (~línea 506, `settlement_failures` insert) **ya tiene** `.then()` y `.catch()` handlers con logging detallado (log de error con txHash, log de warn en éxito). Los ACs no mencionan que ese logging existente debe preservarse al migrar a `after()`. Un implementador podría simplificar y perder trazabilidad. | AC nuevo: "WHEN settlement_failures after() callback completes, success AND error paths SHALL be logged via logger preserving txHash context." |
| F2 | Código actual | ALTA | La instancia #1 (~línea 361, `receipt_signature` update) en el código actual usa `.catch()` inline pero **no tiene `.then()` de éxito**. El WI describe esto como "best effort". No hay AC que especifique si el comportamiento de "best effort" (sin log de éxito) debe preservarse o puede cambiar. | Aclarar si después de migrar a `after()`, se requiere o no log de éxito para el receipt_signature update. |
| F3 | Calidad AC | MEDIA | AC4: "WHEN any after() callback throws, THE error SHALL be logged via logger" — no especifica el nivel de log (warn vs error), ni el contexto mínimo requerido en el log (ej. callId, slug, err). El código actual usa niveles diferentes para diferentes instancias. | Redactar: "WHEN any after() callback throws, THE error SHALL be logged at `logger.error` level with at minimum `{ err, slug }` context." |
| F4 | Calidad AC | MEDIA | AC7: "IF after not available, import SHALL fail at build time" — esto describe el comportamiento por defecto de un import estático de ESM. No es un AC accionable para el implementador; es una consecuencia implícita del fix. No agrega valor verificable. | Remover o reformular como nota de implementación, no como AC. |
| F5 | Dependencias | MEDIA | No hay mención de la **versión mínima de Next.js** requerida para `after()`. `after()` fue introducido como experimental en Next.js 14.x y estabilizado en 15.x. Si el proyecto está en una versión anterior, el import falla en runtime. | Agregar pre-condición: "GIVEN proyecto corre Next.js >= 15.x (stable after()) o tiene `experimental.after: true` en next.config." |
| F6 | Cobertura paths | MEDIA | No hay AC que verifique que `after()` no afecta el **tiempo de respuesta HTTP** (TTFB) de la ruta. El objetivo del fix es precisamente garantizar que las operaciones background no bloqueen la respuesta. | AC nuevo: "WHEN after() callbacks are registered, the HTTP response SHALL be returned to the caller before the callbacks execute." |
| F7 | Calidad AC | BAJA | AC6: "void triggerAgentEvent() calls SHALL remain as-is" — es un AC de "no tocar", que es válido pero inusual. Debería reformularse como restricción de scope más que como AC verificable. | Mover a Scope OUT: "triggerAgentEvent() void calls — sin cambios." |
| F8 | Scope | BAJA | El Scope IN dice "solo las 3 instancias void Promise.resolve()" pero no especifica líneas exactas para las instancias 2 y 3 (solo ~506 y ~542 aproximadas). Con código de ~550+ líneas, un implementador podría confundirse si hay refactors previos. | Confirmar líneas exactas antes de implementación o referenciar por comentario/contexto de código. |

### ACs sugeridos

```
- AC8 (nuevo): GIVEN Next.js version supports after(), WHEN the route file is imported,
  after SHALL be available without runtime errors.
- AC9 (nuevo): WHEN settlement_failures after() callback executes, BOTH success path
  (logger.warn with txHash) AND error path (logger.error with txHash) SHALL be logged
  preserving existing log context.
- AC6 (revisado como restricción de scope): No modificar las llamadas void triggerAgentEvent()
  existentes — mover a Scope OUT en lugar de AC.
- AC4 (revisado): WHEN any after() callback throws or rejects, error SHALL be logged at
  logger.error level with context including at minimum { err, slug }.
```

### Veredicto

**NECESITA CAMBIOS MENORES** — F1 (preservación del logging existente en instancia #2) y F5 (precondición de versión Next.js) son gaps que pueden causar regresiones silenciosas o fallos en entornos con versión de Next.js incorrecta. F2 requiere aclaración de intención. Los demás findings son de calidad de redacción.
