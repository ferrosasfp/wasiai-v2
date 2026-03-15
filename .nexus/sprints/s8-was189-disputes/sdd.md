# SDD #075: WAS-189 — Dispute Resolution para invocaciones fallidas

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: feature
> SDD_MODE: full
> Clasificación: HU-MAJOR

---

## 1. Resumen

El caller que paga por una invocación y recibe un resultado inválido, timeout, o error del agente no tiene mecanismo para reclamar. WAS-189 introduce dispute resolution básico: tabla `disputes` en Supabase, endpoint `POST /api/v1/calls/:call_id/dispute` para abrir un reclamo, y vista en dashboard del creador para ver disputes de sus agentes. La resolución (approve/reject) es manual vía admin endpoint por ahora.

El `call_id` se expone en la respuesta de `/invoke` (nuevo campo `call_id` en `meta`).

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 075 / WAS-189 |
| **Tipo** | feature |
| **Objetivo** | Permitir al caller abrir dispute sobre una invocación; creador ve sus disputes; admin resuelve |
| **Scope IN** | Tabla disputes, endpoint POST dispute, expose call_id en invoke, vista creador, admin resolve |
| **Scope OUT** | Refunds on-chain, dispute on compose/pipeline, auto-resolution, notificaciones email |

---

## 3. Context Map

### Archivos leídos
| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Añadir call_id en response | `buildResponse()` retorna objeto; añadir `meta.call_id` |
| `src/app/api/v1/agent-keys/route.ts` | Auth pattern para nuevo endpoint | `x-api-key` header + `agent_keys` lookup |
| `src/app/api/admin/status/route.ts` | Admin auth pattern | `Authorization: Bearer ADMIN_SECRET` |
| `src/app/[locale]/creator/dashboard/page.tsx` | Dashboard creador | Tabs existentes, patrón de data fetching |
| `supabase/migrations/059_settlement_failures.sql` | Tabla similar | RLS pattern service_only |

### Exemplars
| Para crear/modificar | Seguir patrón de | Razón |
|---------------------|------------------|-------|
| `062_disputes.sql` | `059_settlement_failures.sql` | RLS service_only + estructura similar |
| `src/app/api/v1/calls/[call_id]/dispute/route.ts` | `src/app/api/v1/agents/[slug]/reputation/route.ts` | Dynamic route + auth x-api-key |
| `src/app/api/admin/disputes/route.ts` | `src/app/api/admin/status/route.ts` | Auth Bearer ADMIN_SECRET |

### Estado de BD
| Tabla | Existe | Columnas relevantes |
|-------|--------|---------------------|
| `agent_calls` | Sí | `id`, `agent_id`, `key_id`, `status`, `called_at`, `amount_paid` |
| `agents` | Sí | `id`, `creator_id`, `slug` |
| `disputes` | **No** | A crear |

---

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|----------|
| `supabase/migrations/062_disputes.sql` | Crear | Tabla disputes + RLS + índices | `059_settlement_failures.sql` |
| `src/app/api/v1/calls/[call_id]/dispute/route.ts` | Crear | POST: abrir dispute | `src/app/api/v1/agents/[slug]/reputation/route.ts` |
| `src/app/api/admin/disputes/route.ts` | Crear | GET list + PATCH resolve | `src/app/api/admin/status/route.ts` |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificar | Añadir `call_id` en `buildResponse` meta | — |
| `src/app/[locale]/creator/dashboard/page.tsx` | Modificar | Tab "Disputes" con lista de reclamos | patrón tabs existentes |

### 4.2 Modelo de datos

```sql
CREATE TABLE disputes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id         UUID NOT NULL REFERENCES agent_calls(id),
  agent_id        UUID NOT NULL REFERENCES agents(id),
  caller_key_id   UUID NOT NULL REFERENCES agent_keys(id),
  reason          TEXT NOT NULL,            -- 'bad_output' | 'timeout' | 'no_response' | 'other'
  description     TEXT,                     -- Libre, max 500 chars
  status          TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'approved' | 'rejected'
  resolution_note TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_disputes_agent_id ON disputes(agent_id);
CREATE INDEX idx_disputes_caller_key_id ON disputes(caller_key_id);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE UNIQUE INDEX idx_disputes_call_id_unique ON disputes(call_id); -- 1 dispute por call

-- RLS: solo service_role
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_only" ON disputes USING (false);
GRANT ALL ON disputes TO service_role;
```

### 4.3 Endpoint: POST /api/v1/calls/:call_id/dispute

**Auth:** `x-api-key` (caller key)

**Request body:**
```json
{
  "reason": "bad_output | timeout | no_response | other",
  "description": "opcional, max 500 chars"
}
```

**Orden de operaciones:**
1. Validar auth (x-api-key → key_id)
2. Buscar `agent_call` por `call_id` — verificar que `key_id` coincide (ownership)
3. Verificar que la call tiene ≥1 día de antigüedad no (no limit) y status !== 'success' OR status === 'success' (permitir dispute en cualquier status)
4. Verificar que no existe ya un dispute para este call_id (unique constraint → 409)
5. Insertar dispute
6. Return 201 con `dispute_id`

**Respuesta 201:**
```json
{
  "dispute_id": "uuid",
  "status": "open",
  "message": "Dispute submitted. WasiAI will review within 48h."
}
```

**Errores:**
- 401: key inválida
- 403: call no pertenece a esta key
- 404: call_id no existe
- 409: ya existe dispute para esta call
- 422: reason inválida

### 4.4 Endpoint: GET/PATCH /api/admin/disputes

**Auth:** `Authorization: Bearer ADMIN_SECRET`

**GET** → lista disputes (filtro por status, agent_slug)
**PATCH `/:id`** → `{ status: 'approved' | 'rejected', resolution_note: string }`

### 4.5 invoke/route.ts — exponer call_id

En `buildResponse()`, añadir `call_id` al objeto `meta`:

```typescript
meta: {
  ...existente,
  call_id: callId ?? undefined,  // UUID del agent_call insertado
}
```

`callId` ya existe en scope en Route B (x402). En Route A (agent key), el path de error llama `logCall` sin capturar el id. **Opción A aprobada:** cambiar el else branch a:

```typescript
const { id: errCallId } = await logCall(supabase, model, 'agent', null, null, result, keyRow.id, slug)
callId = errCallId ?? null
```

Así `callId` queda disponible en ambos paths antes de llegar a `buildResponse`.

### 4.6 Dashboard Creador — Tab Disputes

Lista simple: `call_id`, `reason`, `status`, `created_at`. Solo lectura para el creador (no puede resolver, eso es admin).

---

## 5. Acceptance Criteria (EARS)

1. WHEN invoke completa (éxito o error), THE respuesta SHALL incluir `meta.call_id` con el UUID del registro en `agent_calls`.
2. WHEN caller hace `POST /api/v1/calls/:call_id/dispute` con key válida y call propia, THE sistema SHALL crear dispute y devolver 201 con `dispute_id`.
3. WHEN caller intenta abrir dispute sobre call que no le pertenece, THE sistema SHALL devolver 403.
4. WHEN caller intenta abrir segundo dispute sobre mismo call_id, THE sistema SHALL devolver 409.
5. WHEN reason no está en el enum permitido, THE sistema SHALL devolver 422.
6. WHEN admin hace `PATCH /api/admin/disputes/:id` con status válido, THE sistema SHALL actualizar `status`, `resolution_note`, `resolved_at`.
7. WHEN creador visita su dashboard, THE tab "Disputes" SHALL listar disputes de sus agentes con status y reason.

---

## 6. Constraint Directives

### OBLIGATORIO
- Verificar ownership de `call_id` antes de insertar (caller_key_id debe coincidir)
- Usar `createServiceClient()` para escrituras en disputes
- Admin endpoint requiere `ADMIN_SECRET` exactamente como `/api/admin/status`

### PROHIBIDO
- NO implementar refund de USDC (fuera de scope)
- NO permitir que el creador vea disputes de otros creadores
- NO exponer `caller_key_id` raw en respuestas al creador
- NO modificar `agent_calls` ni `settlement_failures`
- NO añadir lógica de resolución automática

---

## 7. Waves de Implementación

### Wave 0 — Pre-flight
- [ ] W0.1: Confirmar que `agent_calls.id` es UUID y se retorna en insert (`RETURNING id`)
- [ ] W0.2: Confirmar que `buildResponse` recibe `callId` accesible en su scope
- [ ] W0.3: `npx tsc --noEmit` pasa

### Wave 1 — BD
- [ ] W1.1: Crear `062_disputes.sql`
- [ ] W1.2: Aplicar migration local (`supabase db push` o SQL directo en dev)

### Wave 2 — invoke call_id
- [ ] W2.1: Modificar `buildResponse` para aceptar `callId` opcional y exponerlo en `meta`
- [ ] W2.2: Pasar `callId` desde los dos puntos de retorno (Route A y Route B)

### Wave 3 — Endpoints
- [ ] W3.1: `POST /api/v1/calls/[call_id]/dispute/route.ts`
- [ ] W3.2: `GET+PATCH /api/admin/disputes/route.ts`

### Wave 4 — UI
- [ ] W4.1: Tab "Disputes" en dashboard creador (lista read-only)

### Wave 5 — Verificación
- [ ] W5.1: `npx tsc --noEmit` limpio
- [ ] W5.2: Test manual local completo (invoke → obtener call_id → POST dispute → GET admin)

---

## 8. Riesgos

| Riesgo | Prob | Impacto | Mitigación |
|--------|------|---------|------------|
| `callId` no disponible en scope de `buildResponse` Route A | M | A | Verificar en W0.2 antes de codificar |
| Migration 062 conflicto con migrations no registradas (054) | B | M | Aplicar solo via SQL directo en dev, no `db push` |
