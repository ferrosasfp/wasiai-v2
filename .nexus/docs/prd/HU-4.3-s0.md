# S0 — HU-4.3: Ejemplos Input/Output Curados
**Fase:** Discovery (S0)  
**Agente:** PM (John) — BMAD v6  
**Fecha:** 2026-02-27  
**Sprint:** 8 | 2026-03-07 → 2026-03-14  
**Prioridad:** P2  
**Estado:** PENDIENTE `HU_APPROVED`  

---

## Historia de Usuario

> Como creator con un agente publicado en WasiAI, quiero poder agregar hasta 5 ejemplos reales de input/output a mi agente, para que los consumers vean exactamente qué hace mi agente antes de gastar su free trial.

---

## Contexto y Motivación

El free trial (HU-3.1) resolvió el "probar sin pagar". Pero antes de probar, el consumer necesita entender _qué_ hace el agente. Los descripciones en texto son insuficientes: los ejemplos concretos de input/output reducen la fricción de evaluación y aumentan la tasa de conversión de "curioso" a "pagador".

Esta HU da a los creators una herramienta sencilla para mostrar el valor real de su agente con ejemplos curados — no resultados de invocaciones en vivo, sino ejemplos preparados por el propio creator.

---

## Acceptance Criteria

| # | Criterio | Cómo verificar |
|---|----------|---------------|
| **AC-1** | En el área de edición del agente en el creator dashboard, existe una sección "Ejemplos de uso" donde el creator puede ver, agregar, editar y eliminar ejemplos. | Screenshot del creator dashboard con la sección visible |
| **AC-2** | Cada ejemplo tiene: campo **Input** (textarea, máx 500 chars), campo **Output esperado** (textarea, máx 1000 chars), campo **Etiqueta** opcional (input text, máx 60 chars). Los límites se validan en frontend Y en el API (no solo en frontend). | Test: intentar enviar vía API con input de 501 chars → debe rechazar con 400 |
| **AC-3** | El máximo de ejemplos por agente es 5. Si el creator ya tiene 5, el botón "Agregar ejemplo" se deshabilita y muestra el mensaje `"Máximo 5 ejemplos por agente"`. | Test: crear 5 ejemplos, verificar que el botón se deshabilita |
| **AC-4** | ~~El creator puede reordenar los ejemplos (drag & drop o botones ↑↓). El orden se persiste en `sort_order`.~~ **[REEMPLAZADO por decisión MVP — ver DT-1]** Los ejemplos se muestran en orden de creación (`created_at ASC`). No hay reordenamiento manual en este sprint. El campo `sort_order` existe en la tabla pero no se expone en la UI en esta HU. | Al crear ejemplos, verificar que el orden de listado sigue `created_at ASC` |
| **AC-4b** | Los ejemplos se muestran en orden de creación. Reordenamiento manual es deuda técnica documentada (ver sección "Deuda Técnica"). El botón de reordenar / drag & drop **no existe** en esta versión. | Screenshot del creator dashboard: no debe haber UI de reordenar |
| **AC-5** | Los ejemplos se almacenan en la tabla `agent_examples` con RLS activo. Solo el creator dueño del agente puede crear/editar/eliminar sus propios ejemplos. | Intentar editar ejemplo de otro creator vía API → debe retornar 403 |
| **AC-6** | La política RLS de escritura valida que `creator_id = auth.uid()` Y que el `agent_id` pertenece a ese creator (no se puede agregar un ejemplo a un agente ajeno). | Test de seguridad: POST a `/api/creator/agents/[id_ajeno]/examples` → 403 |
| **AC-7** | En la ficha pública del agente (`/agents/[slug]`), si hay ejemplos, se muestran en un **accordion**: cada fila muestra la etiqueta (o "Ejemplo N" si no hay etiqueta), expandible para ver Input y Output. | Screenshot de ficha pública con accordion expandido |
| **AC-8** | Si el agente no tiene ejemplos, la sección "Ejemplos" **no aparece** en la ficha pública. Sin empty state, sin placeholder. | Test con agente sin ejemplos: sección invisible |
| **AC-9** | Los ejemplos son opcionales para publicar. El agente puede existir y estar activo sin ningún ejemplo. | Verificar que el flujo de publicación no tiene validación de "al menos 1 ejemplo" |
| **AC-10** | La migration se nombra exactamente `017_agent_examples.sql` (próxima disponible según `project-context.md`). | `ls supabase/migrations/ | grep 017` |
| **AC-11** | La tabla tiene índice en `(agent_id, sort_order)` para ordenar eficientemente al leer la ficha pública. | Revisar migration: `CREATE INDEX idx_agent_examples_agent_id ON agent_examples(agent_id, sort_order)` |
| **AC-12** | Traducciones en `es` y `en` para todas las etiquetas de la UI: `examples.title`, `examples.add`, `examples.inputLabel`, `examples.outputLabel`, `examples.tagLabel`, `examples.maxReached`, `examples.noExamples` (solo uso interno, no visible en público), `examples.example` | `grep -r "examples\." src/messages/` |

---

## Decisiones Técnicas

### DT-1: sort_order de ejemplos — MVP usa orden de creación

**Contexto (observación San):** El drag & drop en mobile es complejo y propenso a bugs. Para MVP, no justifica el costo de implementación.

**Decisión:** Los ejemplos se ordenan por `created_at ASC` (orden de creación). El campo `sort_order` se mantiene en la tabla para uso futuro, pero en esta HU siempre valdrá el mismo default (0) o simplemente se ignorará en el ORDER BY.

**Query de lectura:**
```sql
SELECT * FROM agent_examples
WHERE agent_id = $1
ORDER BY created_at ASC
```

**Impacto:** El endpoint `PATCH /api/creator/agents/[id]/examples/reorder` **NO se implementa** en esta HU. El scope se reduce.

---

## Deuda Técnica

| Item | Descripción | Prioridad sugerida |
|------|-------------|-------------------|
| **DT-EXAMPLES-01** | Reordenamiento manual de ejemplos (drag & drop o botones ↑↓). Implementar cuando se use `sort_order` real en el ORDER BY. Requiere UI de drag & drop (ej. `@dnd-kit`) y endpoint `PATCH .../reorder`. | P3 — backlog |

---

## Scope

### Archivos a CREAR

| Archivo | Descripción |
|---------|-------------|
| `supabase/migrations/017_agent_examples.sql` | Tabla `agent_examples` + RLS + índice (ver schema abajo) |
| `src/features/creator/components/AgentExamples.tsx` | Editor CRUD de ejemplos para el creator. Client component con SWR o fetch nativo. |
| `src/features/models/components/AgentExamplesDisplay.tsx` | Accordion público para mostrar ejemplos en la ficha. Server Component preferido. |
| `src/app/api/creator/agents/[id]/examples/route.ts` | API CRUD: GET (listar), POST (crear), PATCH (actualizar), DELETE (eliminar). Auth required. |

### Archivos a MODIFICAR

| Archivo | Cambio |
|---------|--------|
| `src/app/[locale]/creator/dashboard/page.tsx` (o la ruta de edición de agente) | Incluir `<AgentExamples agentId={agent.id} />` en la sección de edición del agente. Verificar antes cuál es la ruta real de edición. |
| `src/app/[locale]/agents/[slug]/page.tsx` | Incluir `<AgentExamplesDisplay agentId={agent.id} />` solo si `examples.length > 0` |
| `src/messages/en.json` | Agregar `"examples": { ... }` |
| `src/messages/es.json` | Agregar `"examples": { ... }` |

### Archivos a NO TOCAR

- Contratos Solidity
- Tabla `agents` — sin columnas nuevas
- API de invocación de agentes

---

## Schema de la Tabla

```sql
-- supabase/migrations/017_agent_examples.sql

CREATE TABLE agent_examples (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  creator_id  UUID        NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  label       TEXT        CHECK (char_length(label) <= 60),
  input       TEXT        NOT NULL CHECK (char_length(input) <= 500),
  output      TEXT        NOT NULL CHECK (char_length(output) <= 1000),
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE agent_examples ENABLE ROW LEVEL SECURITY;

-- Lectura pública (para la ficha del agente)
CREATE POLICY "Public read agent_examples"
  ON agent_examples FOR SELECT
  USING (true);

-- Solo el creator dueño puede escribir (INSERT, UPDATE, DELETE)
CREATE POLICY "Creator write agent_examples"
  ON agent_examples FOR ALL
  USING (creator_id = auth.uid());

-- Índice para ordenar por agente
CREATE INDEX idx_agent_examples_agent_id
  ON agent_examples(agent_id, sort_order);

-- Trigger para updated_at automático
CREATE TRIGGER set_agent_examples_updated_at
  BEFORE UPDATE ON agent_examples
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

**Nota:** El límite de 5 ejemplos por agente se enforcea en el API layer (`/api/creator/agents/[id]/examples` → `POST` verifica `COUNT(*) < 5`), no en la DB. Esto es intencional: más simple y flexible.

---

## Endpoints API (referencia para Dev/S1)

```
GET    /api/creator/agents/[id]/examples         → lista ejemplos del agente (auth required, solo el creator); ORDER BY created_at ASC
POST   /api/creator/agents/[id]/examples         → crear ejemplo (verifica count < 5)
PATCH  /api/creator/agents/[id]/examples/[exId]  → editar ejemplo
DELETE /api/creator/agents/[id]/examples/[exId]  → eliminar ejemplo
-- PATCH .../reorder → NO implementar en esta HU (deuda técnica DT-EXAMPLES-01)
```

Todos requieren auth. La validación de ownership (`agent pertenece al creator autenticado`) se hace en el handler, no solo en RLS.

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| El trigger `moddatetime` puede no estar disponible en Supabase free | Baja | Bajo | Si no existe, usar `NOW()` en el UPDATE: `SET updated_at = NOW()` en el handler. No depender del trigger en el código. |
| La ruta de edición de agente no está clara (dashboard vs `/creator/agents/[id]/edit`) | Media | Medio | AC-1 requiere que el Dev verifique cuál existe antes de implementar. Si no hay ruta de edición por agente, se incluye en el dashboard principal. |
| Creator sube ejemplos de mala calidad, spam o contenido ofensivo | Media | Bajo | Límites de chars enforced en frontend + API. Moderación reactiva es roadmap. Para MVP, sin filtro automático. |
| Drag & drop en mobile puede ser difícil de implementar bien | N/A | N/A | **[RIESGO ELIMINADO — observación San]** Drag & drop NO se implementa en esta HU. Para MVP se usa orden de creación (`created_at ASC`). Reordenamiento manual queda como deuda técnica DT-EXAMPLES-01. |
| `ON DELETE CASCADE` en `agent_id` puede eliminar ejemplos sin aviso al creator | Baja | Bajo | Comportamiento correcto: si el agente se elimina, sus ejemplos también. No hay action required. |

---

## Estimación

**Tamaño:** M — 4-6 horas de desarrollo (incluyendo migration y CRUD completo)  
**Complejidad:** Media (migration + RLS + API CRUD + 2 componentes UI)  
**Dependencias:** Migration 017 debe aplicarse en staging antes de implementar cualquier componente.

---

## Definition of Done (para QA)

- [ ] `supabase/migrations/017_agent_examples.sql` aplicada en staging, sin errores
- [ ] RLS activo: creator no puede editar ejemplos ajenos (test con dos cuentas)
- [ ] CRUD completo funciona: crear, leer, editar, eliminar (sin reordenar — deuda técnica)
- [ ] Ejemplos se listan en orden de creación (`created_at ASC`) en el dashboard y en la ficha pública
- [ ] Límite de 5 ejemplos enforced en API (no solo en frontend)
- [ ] Validaciones de char_length en API (input 500, output 1000, label 60)
- [ ] Ficha pública: accordion con ejemplos visible si hay datos, invisible si no hay
- [ ] Agente sin ejemplos puede publicarse sin errores
- [ ] `npm run build` sin errores TypeScript
- [ ] Traducciones `examples.*` en `en.json` y `es.json`
- [ ] Nombre del archivo de migration es exactamente `017_agent_examples.sql`

---

*Generado por PM (John) — BMAD v6 — 2026-02-27*  
*Revisado por San (orquestradora) — 2026-02-27: Observaciones técnicas integradas (DT-1 sort por created_at para MVP, drag & drop → deuda técnica DT-EXAMPLES-01, AC-4 reemplazado por AC-4 + AC-4b, endpoint reorder eliminado del scope)*  
*Gate requerido: Fer escribe `HU_APPROVED` después de leer este documento*
