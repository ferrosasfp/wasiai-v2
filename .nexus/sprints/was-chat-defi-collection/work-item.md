# Work Item — Chat DeFi Collection

**Issue:** WAS-CHAT-DEFI-COLLECTION  
**Clasificación:** HU-MAJOR  
**Fecha:** 2026-03-21  
**Sprint dir:** `.nexus/sprints/was-chat-defi-collection/`

---

## Contexto

El endpoint `/api/v1/chat` actualmente tiene los agentes disponibles hardcodeados en el `PLANNER_SYSTEM` prompt como strings estáticos. Esto es frágil, difícil de mantener y expone lógica de negocio en el código fuente.

El sistema ya tiene las tablas `collections` y `collection_agents` (migración `038_collections.sql`). Se propone:

1. Crear una colección "DeFi Chat" en BD con los 5 agentes del chat
2. Modificar el endpoint `/api/v1/chat` para leer los agentes disponibles desde esa colección en runtime
3. Generar el `PLANNER_SYSTEM` dinámicamente a partir de los agentes de la colección

---

## Acceptance Criteria (EARS format)

**AC1** — Creación de colección en BD  
WHEN se ejecuta la migración, THEN debe existir una fila en `collections` con `slug = 'defi-chat'` y 5 filas en `collection_agents` apuntando a los agentes: `wasi-chainlink-price`, `wasi-defi-sentiment`, `wasi-onchain-analyzer`, `wasi-contract-auditor`, `wasi-risk-report`.

**AC2** — Planner dinámico  
WHEN el endpoint `/api/v1/chat` recibe un POST, THEN debe leer los agentes activos de la colección `defi-chat` desde BD antes de construir el prompt del planner. El PLANNER_SYSTEM hardcodeado debe ser eliminado.

**AC3** — Formato del prompt generado  
WHEN la colección tiene N agentes activos con `input_schema` definido, THEN el prompt generado debe incluir para cada agente: su `slug`, su `name` o description, y sus propiedades de input extraídas del `input_schema`.

**AC4** — Fallback si colección vacía  
WHEN la colección `defi-chat` no existe o no tiene agentes activos, THEN el endpoint debe retornar `503` con `code: 'chat_unavailable'` en lugar de ejecutar un planner sin agentes.

**AC5** — Sin breaking changes  
WHEN el endpoint recibe una pregunta válida con agentes disponibles, THEN el response shape debe ser idéntico al actual: `{ answer, steps, receipts, total_cost_usdc, pipeline_id }`.

**AC6** — Agentes solo de la colección  
WHEN el planner selecciona agentes, THEN solo puede seleccionar slugs que pertenezcan a la colección `defi-chat`. Si el LLM alucina un slug fuera de la colección, el compose lo rechazará naturalmente.

**AC7** — Cache de colección  
WHEN se hacen múltiples requests al chat en el mismo proceso, THEN la lista de agentes de la colección debe ser cacheada en memoria (TTL: 60 segundos) para evitar una query a BD por cada request.

---

## Archivos afectados

| Archivo | Acción |
|---------|--------|
| `supabase/migrations/XXX_defi_chat_collection.sql` | CREAR — inserta colección y agentes |
| `src/app/api/v1/chat/route.ts` | MODIFICAR — planner dinámico desde BD |

## Archivos de referencia

| Archivo | Por qué |
|---------|---------|
| `supabase/migrations/038_collections.sql` | Schema de las tablas |
| `src/app/api/v1/chat/route.ts` | Código actual a modificar |
| `src/lib/supabase/server.ts` | createServiceClient para la query |

---

## Out of Scope

- No crear UI de administración de colecciones
- No exponer la colección vía API pública (GET /collections/defi-chat)
- No modificar el endpoint de compose
- No cambiar la autenticación del chat

---

## Rollback

Si algo falla post-deploy:
1. Revertir `route.ts` al commit `4986fd815` (planner estático)
2. La migración SQL es idempotente (INSERT OR IGNORE) — no destruye datos existentes
