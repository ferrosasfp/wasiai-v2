# Requirements Review — WAS-256

> Revisor: Requirements Reviewer (subagente NexusAgile v1.3)
> Fecha: 2026-03-21
> Artefacto: work-item.md

---

## Findings

| # | Severidad | Categoría | Descripción | AC afectado |
|---|-----------|-----------|-------------|-------------|
| F1 | 🔴 CRÍTICO | Dependencia no declarada | `getCollectionAgents()` está definida como función privada dentro de `chat/route.ts` (no exportada). El work item dice "reusar el patrón" pero no se puede importar directamente. Implementar la demo route requiere duplicar la función o extraerla a `src/lib/agents/collection.ts`. Esta refactorización no está en "Archivos afectados". | AC2 |
| F2 | 🔴 CRÍTICO | Constraint posiblemente imposible | El flujo completo encadena: LLM planner (≤10s) + compose con hasta 3 agentes externos (≤45s) + LLM report (≤10s). El tiempo total puede superar fácilmente los 60s de `maxDuration` en el peor caso. El AC1 garantiza "≤60 segundos" pero sin timeouts intermedios definidos esto es inviable de garantizar. | AC1 |
| F3 | 🔴 CRÍTICO | Archivo afectado faltante | AC8 dice que el card de Chat DeFi collection NO debe tener botón a `/demo`. Esto implica que actualmente existe ese botón en algún componente. El archivo que lo contiene (probablemente un CollectionCard o similar) **no aparece en "Archivos afectados"**. Puede ser un blocker silencioso. | AC8 |
| F4 | 🟠 MAYOR | Edge case faltante | No hay AC para `x-api-key` ausente o inválida en el demo endpoint. El chat/route.ts devuelve 401 en este caso. La demo route debe tener el mismo comportamiento pero no está especificado. ¿La UI del demo debe manejar un 401? ¿Con qué mensaje? | AC1, AC7 |
| F5 | 🟠 MAYOR | Edge case faltante | No hay AC para `goal` vacío, nulo, o excediendo longitud máxima. El chat route valida `question` con máx 500 chars y devuelve 400. El work item no define ninguna validación de input para `goal`. | AC1, AC3 |
| F6 | 🟠 MAYOR | Edge case faltante | No hay AC para fallo en fase Discovery (p.ej. DB caída, `getCollectionAgents` lanza error, o retorna array vacío). El chat/route.ts devuelve 503 en este caso. El demo endpoint no especifica qué HTTP status ni qué `phases` entry corresponde. | AC2, AC6 |
| F7 | 🟠 MAYOR | Edge case faltante | No hay AC para fallo del LLM en fase Report. El chat/route.ts usa "fail-open" (devuelve JSON crudo). El demo debe definir si falla abierto o cierra con error, y cómo se refleja en `phases[report].status`. | AC5, AC6 |
| F8 | 🟠 MAYOR | Dependencia no declarada | La llamada interna a `/api/v1/compose` requiere la variable de entorno `NEXT_PUBLIC_SITE_URL`. Esto no está documentado en el work item. Si la var no está definida, la URL fallback es `https://app.wasiai.io` (hardcoded en chat/route.ts) — puede causar loops o fallos en dev. | AC4 |
| F9 | 🟡 MENOR | Ambigüedad UI | AC7 describe los elementos de UI pero no especifica qué muestra la UI en caso de error (422 goal no-DeFi, 502 compose failure, etc.). El desarrollador tendrá que asumir. ¿Toast? ¿Inline error? ¿El campo report muestra el mensaje de error? | AC7 |
| F10 | 🟡 MENOR | Ambigüedad UI | La página está en `[locale]/demo` pero no hay mención de strings i18n. ¿El texto es hardcoded en inglés? ¿Debe agregarse a los archivos de traducción? Si el proyecto usa `next-intl`, los textos hardcoded romperán la consistencia. | AC7 |
| F11 | 🟡 MENOR | Ambigüedad de contrato | AC1 incluye `pipeline_id` en la respuesta 200. AC6 describe `phases[]`. Pero no hay AC que defina qué pasa con `phases` cuando una fase intermedia falla parcialmente (p.ej. execution falla). ¿`phases` se trunca o incluye todas con status `failed`? | AC4, AC6 |
| F12 | 🟡 MENOR | AC no verificable | AC5 dice "≤300 palabras" para el report. No hay AC de test que valide ese conteo, y el `SUMMARY_SYSTEM` prompt del chat limita a 256 tokens (no palabras). Hay ambigüedad entre tokens y palabras como unidad de medida. | AC5 |
| F13 | 🟢 INFO | Observación | AC3 menciona "retorna 422 si el goal no es DeFi/crypto" — este comportamiento ya está implementado en el patrón del chat (el LLM planner devuelve `[]`). La lógica es reutilizable. Solo asegurarse de que el `phases` entry para planning refleje `status: "skipped"` o `"rejected"`. | AC3 |

---

## Veredicto

### ⛔ REQUIERE CORRECCIÓN

El work item tiene **3 issues críticos** (F1, F2, F3) que pueden bloquear la implementación o producir un demo que falle silenciosamente. Los issues F4–F8 son mayores y deben resolverse antes de que el desarrollador comience a implementar.

**Mínimo necesario para aprobar (dado el contexto de hackathon):**
1. Declarar explícitamente si `getCollectionAgents()` se extrae a un shared module o se duplica — y actualizar "Archivos afectados" en consecuencia
2. Agregar AC para auth fallida (401) y goal inválido (400)
3. Definir comportamiento en fallo de Discovery (503)
4. Identificar y listar el archivo del collection card que tiene el botón a `/demo`

---

## Recomendaciones (Quick-fix para hackathon)

Dado el tiempo límite (domingo 22 marzo), se sugiere:

1. **F1 → Duplicar `getCollectionAgents()`** en `autonomous/route.ts` en lugar de refactorizar. Técnicamente deuda, pero es la ruta más rápida. Documentar como TODO.

2. **F2 → Agregar timeout explícito** en la llamada a compose: `AbortController` con 45s. Si excede, retornar 504 con `phases[execution].status = "timeout"`.

3. **F3 → Buscar con `grep -r "/demo"` en `src/components`** antes de implementar para identificar el componente a modificar.

4. **F4+F5 → Agregar validación simple**: `if (!goal || typeof goal !== 'string' || goal.trim().length === 0) return 400` y `if (goal.length > 1000) return 400`.

5. **F9 → Definir** que en caso de error, el campo `report` de la UI muestra el `error` string del body de la respuesta. Simple, consistente, implementable en 10 minutos.
