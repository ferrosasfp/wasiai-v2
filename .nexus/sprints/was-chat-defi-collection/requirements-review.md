# Requirements Review — Chat DeFi Collection

**Reviewer:** Requirements Reviewer (NexusAgile v1.3)  
**Issue:** WAS-CHAT-DEFI-COLLECTION  
**Fecha revisión:** 2026-03-21  

---

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F1 | Schema mismatch | CRÍTICA | Los `input_schema` de los agentes en prod difieren del hardcoded actual. `wasi-chainlink-price` tiene `[token, token_symbol]`, no solo `{token}`. `wasi-contract-auditor` acepta `[token, contract_source]`, no `{address}`. `wasi-defi-sentiment` tiene `[token, token_name]`. `wasi-risk-report` tiene `[token, description]`. El PLANNER_SYSTEM actual está desincronizado con prod. Si AC3 genera el prompt desde el `input_schema` real, el LLM recibirá props distintas a las que sabe usar. Riesgo de regresión silenciosa. | AC3 debe especificar qué sucede cuando el `input_schema` de prod contradice el comportamiento esperado del planner (necesita prueba de integración explícita) |
| F2 | Error path ausente | CRÍTICA | No existe ningún AC para fallo de BD en runtime. AC4 cubre "colección vacía/no existe" pero no "error de conexión / timeout al consultar la colección". ¿El endpoint retorna 503? ¿500? ¿Usa el prompt hardcodeado como fallback? | Nuevo AC8 (ver abajo) |
| F3 | Definición ambigua | ALTA | AC2 dice "leer los agentes **activos**" pero ni `collections` ni `collection_agents` tienen columna `active`/`is_active` en el schema de `038_collections.sql`. ¿El filtro de "activo" viene de la tabla `agents`? Si es así, la query JOIN no está descrita. | AC2 debe especificar: "agentes cuyo campo `agents.active = true`" (o equivalente) y mencionar el JOIN necesario |
| F4 | Error path ausente | ALTA | AC3 solo cubre agentes con `input_schema` definido. No hay AC para agentes en la colección que tengan `input_schema = null` o `{}`. ¿Se omiten del prompt? ¿Se incluyen sin propiedades? ¿Abortan la carga? | Nuevo AC9 (ver abajo) |
| F5 | Enforcement mechanism ausente | ALTA | AC6 dice que el planner "solo puede seleccionar slugs de la colección" pero no describe el mecanismo de validación post-LLM. El LLM puede alucinar slugs. ¿Se filtra el output? ¿Se rechaza la request? ¿Con qué HTTP code? | AC6 debe agregar: "THEN los slugs no presentes en la colección deben ser filtrados/rechazados antes de ejecutar el pipeline" |
| F6 | Migration gap | ALTA | `collection_agents` referencia `agent_id uuid` (FK a `agents.id`), pero AC1 especifica agentes por **slug**, no por UUID. La migración necesita resolver slug → UUID con un `SELECT id FROM agents WHERE slug = '...'`. No hay AC que cubra qué pasa si un slug no existe en BD al correr la migración. | AC1 debe agregar: "IF algún slug no existe en `agents`, THEN la migración debe fallar con mensaje descriptivo (no insertar parcialmente)" |
| F7 | Cache en entorno serverless | MEDIA | AC7 define cache en memoria con TTL 60s. Next.js en serverless/edge puede tener múltiples instancias concurrentes sin estado compartido. El cache no se comparte entre instancias. Esto puede causar comportamiento inconsistente y N queries simultáneas en cold-start. El AC no menciona esta limitación ni si es aceptable. | AC7 debe agregar aclaración: "Esta cache es por-instancia (in-process). En entorno serverless con múltiples instancias, el comportamiento es best-effort." |
| F8 | Idempotencia no testeada | MEDIA | El Rollback afirma "la migración es idempotente" pero no hay AC que lo verifique. ¿Usa `INSERT ... ON CONFLICT DO NOTHING`? ¿`IF NOT EXISTS`? Si la migración se corre dos veces, ¿qué pasa con las filas duplicadas en `collection_agents`? | AC1 debe agregar: "WHEN la migración se ejecuta más de una vez, THEN no debe crear filas duplicadas ni lanzar error" |
| F9 | Scope creep latente | MEDIA | Los agentes `wasi-liquidity-analyzer` y `wasi-wallet-profiler` existen en prod pero no están en la colección ni en Scope OUT. Si un stakeholder los pide después del release, hay riesgo de expandir scope sin nueva HU. | Agregar a Out of Scope: "No agregar wasi-liquidity-analyzer ni wasi-wallet-profiler a esta colección" |
| F10 | AC solapado | BAJA | AC4 ("colección vacía → 503") y AC6 ("planner solo usa slugs de la colección") pueden generar un estado inconsistente: si el filtro de AC6 elimina todos los slugs alucinados del LLM, el resultado es un pipeline vacío que no está cubierto por AC4 (que solo actúa antes de construir el prompt). ¿Este caso retorna 503 también? | Aclarar en AC4: incluir el caso "pipeline vacío por slugs inválidos post-validación" |
| F11 | Response errors no especificados | BAJA | AC5 garantiza el response shape en happy path pero no especifica el shape de error en los casos cubiertos por AC4/F2. ¿El 503 siempre retorna `{code: 'chat_unavailable'}`? ¿Hay mensaje? ¿Campo `details`? | AC4 debe especificar el body completo del 503: `{ code: 'chat_unavailable', message?: string }` |
| F12 | maxDuration no revisado | BAJA | `route.ts` tiene `maxDuration = 60`. Con la query a BD adicional (y cache miss) sumada al tiempo de LLM + pipeline, hay riesgo de timeout en cold-start. No es un AC, pero debería estar en una nota técnica o en los archivos afectados. | Agregar nota en Work Item: "Revisar si maxDuration debe incrementarse dado el overhead de la query inicial" |

---

### ACs sugeridos (agregar al Work Item)

**AC8** — Error de BD en runtime  
WHEN la consulta a BD para obtener los agentes de la colección falla (timeout, conexión rechazada, error inesperado), THEN el endpoint SHALL retornar `503` con `code: 'chat_unavailable'` y SHALL registrar el error en logs con nivel `error`. No usar el PLANNER_SYSTEM hardcodeado como fallback.

**AC9** — Agente sin input_schema  
WHEN un agente de la colección `defi-chat` tiene `input_schema = null` o `input_schema = {}`, THEN dicho agente SHALL ser omitido del prompt generado Y SHALL ser excluido de la lista de slugs válidos para AC6. WHEN todos los agentes carecen de `input_schema`, THEN aplicar AC4 (retornar 503).

---

### Veredicto

**NECESITA CAMBIOS**

- **2 hallazgos CRÍTICOS** (F1, F2) que representan riesgo de regresión silenciosa y comportamiento indefinido en producción.
- **4 hallazgos ALTOS** (F3, F4, F5, F6) con ambigüedades que bloquearán la implementación o producirán bugs.
- Los ACs AC8 y AC9 son obligatorios antes de pasar a Spec.
- F1 requiere una decisión de producto: ¿el prompt dinámico reemplaza la semántica actual del planner o la preserva? Eso debe ser validado con una prueba de integración explícita en QA.
