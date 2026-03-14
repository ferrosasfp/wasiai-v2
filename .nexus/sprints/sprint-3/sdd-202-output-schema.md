# SDD #202: Output Schema Validation antes de settlement

> SPEC_APPROVED: no
> Fecha: 2026-03-13
> Tipo: feature / improvement
> SDD_MODE: full
> Clasificación: QUALITY
> Branch: feat/202-output-schema-validation

---

## 1. Resumen

Hoy WasiAI valida el **input** antes de cobrar (WAS-200). Esta HU cierra el ciclo: valida el **output** del agente antes de confirmar el pago. Si el agente prometió devolver JSON con cierto formato y devuelve basura, el caller recibe un reembolso y el creador no cobra. La validación usa AJV igual que input.

Requiere: 1) nueva columna `output_schema` en `agents`, 2) nueva columna `result_type` en `agent_calls`, 3) validación post-llamada en sandbox y compose antes de confirmar el `agent_calls.insert`.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | WAS-202 |
| **Tipo** | feature |
| **Objetivo** | Validar output del agente contra output_schema antes de confirmar pago |
| **Reglas de negocio** | Si output inválido → refund + status schema_violation + creator no cobra |
| **Scope IN** | Migración 055/056, sandbox/invoke, compose, EditAgentForm, Step3Technical, model schema |
| **Scope OUT** | UI de dashboard de creator (AC-3 — solo conteo DB, UI en sprint futuro), contratos on-chain |

### Acceptance Criteria (EARS)

- **AC-1:** WHEN agent has `output_schema` declared AND agent returns output, THEN system SHALL validate output against output_schema using AJV before inserting to `agent_calls`
- **AC-2:** WHEN output fails validation, THEN system SHALL: refund the charge, insert `agent_calls` with `result_type: 'schema_violation'`, return 422 `output_schema_violation` to caller
- **AC-3:** WHEN agent has no `output_schema`, THEN system SHALL skip output validation (no behavior change)
- **AC-4:** WHEN output validation passes, THEN system SHALL insert `agent_calls` with `result_type: 'success'`
- **AC-5:** WHEN creator publishes/edits agent, THEN they SHALL be able to declare an `output_schema` (JSON Schema draft-07)
- **AC-6:** WHEN output_schema is saved, THEN system SHALL meta-validate it (same as input_schema — AJV compile check + SSRF block)
- **AC-7:** WHEN `npx tsc --noEmit` runs after implementation, THEN it SHALL pass with no errors

---

## 3. Context Map

### Archivos leídos
| Archivo | Por qué | Patrón extraído |
|---------|---------|----------------|
| `supabase/migrations/054_input_schema.sql` | Template para output_schema migration | `ALTER TABLE agents ADD COLUMN IF NOT EXISTS input_schema JSONB` |
| `src/app/api/v1/sandbox/invoke/[slug]/route.ts` líneas 250-310 | Settlement actual sandbox | Orden: call agent → if failed refund → insert agent_calls |
| `src/app/api/v1/compose/route.ts` líneas 490-540 | Settlement actual compose | Orden similar: call → charge → insert |
| `src/lib/schema-validator.ts` | Validación existente | `validateInput(schema, value)` → reusar para output |
| `src/lib/schemas/model.schema.ts` | Schema Zod del agente | `input_schema: z.record(z.string(), z.unknown()).optional().nullable()` — duplicar para output |
| `src/components/publish/Step3Technical.tsx` | UI publish | Ya tiene textarea para input_schema — duplicar patrón |
| `src/app/[locale]/creator/agents/[slug]/edit/EditAgentForm.tsx` | UI edit | Ya tiene field input_schema — duplicar patrón |
| `doc/DB_SCHEMA.md` | Estado real DB | `agent_calls` no tiene `result_type`; `agents` no tiene `output_schema` |

### Estado de BD relevante
| Tabla | Columna | Existe | Acción |
|-------|---------|--------|--------|
| `agents` | `output_schema` | ❌ | Migración: `ADD COLUMN output_schema JSONB` |
| `agent_calls` | `result_type` | ❌ | Migración: `ADD COLUMN result_type TEXT DEFAULT 'success'` |

### Componentes reutilizables
- `validateInput(schema, value)` en `src/lib/schema-validator.ts` — reusar para output (misma función, mismo AJV)
- `metaValidateSchema(schema)` — reusar para validar output_schema al guardar
- Patrón textarea JSON en `Step3Technical.tsx` líneas ~200-220 — copiar para output_schema

---

## 4. Diseño técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|----------|
| `supabase/migrations/056_output_schema.sql` | Crear | ADD COLUMN output_schema en agents, result_type en agent_calls | `054_input_schema.sql` |
| `src/app/api/v1/sandbox/invoke/[slug]/route.ts` | Modificar | Validar output antes de agent_calls insert | Pattern del input validation (líneas ~156-175) |
| `src/app/api/v1/compose/route.ts` | Modificar | Validar output antes de agent_calls insert en executeStep | Pattern del input validation (~línea 576) |
| `src/lib/schemas/model.schema.ts` | Modificar | Agregar `output_schema` al schema Zod | `input_schema` field existente |
| `src/components/publish/Step3Technical.tsx` | Modificar | Agregar textarea output_schema | Textarea input_schema existente |
| `src/app/[locale]/creator/agents/[slug]/edit/EditAgentForm.tsx` | Modificar | Agregar field output_schema en state + UI + submit | input_schema field existente |
| `src/app/[locale]/publish/PublishForm.tsx` | Modificar | Incluir output_schema en PATCH de Step3 | `sandbox_enabled` + `input_schema` ya incluidos |
| `src/app/api/v1/agents/[slug]/route.ts` | Modificar | Incluir output_schema en GET response | `input_schema` ya incluido (línea 96) |
| `src/app/api/v1/agents/route.ts` | Modificar | Incluir output_schema en SELECT + map | `input_schema` ya incluido |
| `messages/en.json` + `messages/es.json` | Modificar | Claves i18n para output_schema en UI | Claves `inputSchemaLabel` existentes |

### 4.2 Modelo de datos

```sql
-- agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS output_schema JSONB;

-- agent_calls
ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS result_type TEXT DEFAULT 'success';
-- valores: 'success' | 'schema_violation' | 'agent_error'
```

### 4.3 Orden de bloques en sandbox/invoke (CRÍTICO — A2 retro)

```
parse body
→ validate input_schema (AC-7 WAS-200)
→ deduct_sandbox_balance
→ SSRF check endpoint
→ call agent
→ if agent failed → refund → return 422
→ [NUEVO] if output_schema → validateOutput → if invalid → refund → insert agent_calls(result_type: schema_violation) → return 422 output_schema_violation
→ insert agent_calls(result_type: success)
→ return 200
```

### 4.4 Orden de bloques en compose/executeStep (CRÍTICO)

```
→ call agent
→ if failed → charge decision (existing logic)
→ [NUEVO] if output_schema → validateOutput → if invalid → refund → insert agent_calls(result_type: schema_violation) → ABORT pipeline (mismo comportamiento que agentFailed)
→ insert agent_calls(result_type: success)
→ continue pipeline

NOTA: schema_violation en compose ABORTA el pipeline completo. Razón: el output inválido sería el input del siguiente step → resultado final incorrecto de todas formas.
```

### 4.5 Flujo principal

1. Agente tiene `output_schema` declarado
2. Caller invoca agente (sandbox o compose)
3. Agente responde con JSON
4. Sistema valida JSON contra `output_schema` con AJV
5. Si válido → `agent_calls.insert(result_type: 'success')` → 200
6. Si inválido → refund → `agent_calls.insert(result_type: 'schema_violation')` → 422 `output_schema_violation`

### 4.6 Flujo de error

- Agente no tiene `output_schema` → skip validación, behavior sin cambio (AC-3)
- Output válido pero agente falló HTTP → camino existente (agentFailed), sin cambio
- AJV lanza excepción al compilar output_schema → skip validación (mismo patrón que validateInput catch)

---

## 5. Constraint Directives

### OBLIGATORIO
- Reusar `validateInput(schema, value)` para output — NO crear nueva función AJV
- Reusar `metaValidateSchema` para validar output_schema al guardar
- Consultar `doc/DB_SCHEMA.md` antes de escribir SQL
- `agent_calls.called_at` es el timestamp canónico (NO `created_at`)
- Mantener el orden de bloques documentado en 4.3 y 4.4
- i18n: todos los strings UI via `t()` — NO hardcodear

### PROHIBIDO
- NO agregar columna `result_type` a tablas distintas de `agent_calls`
- NO crear nueva instancia de AJV — reusar la del schema-validator
- NO tocar lógica de billing/pricing existente
- NO modificar contratos on-chain
- NO hacer `git push`
- NO modificar `sandbox/balance/route.ts`
- NO cambiar la firma pública de `checkIpLimit`

---

## 6. Waves (máx 4)

### Wave 0 — Pre-flight
- [ ] W0.1: `npx tsc --noEmit` baseline
- [ ] W0.2: Leer `054_input_schema.sql` (template)
- [ ] W0.3: Leer `sandbox/invoke/route.ts` completo (orden de bloques)
- [ ] W0.4: Leer `compose/route.ts` — función `executeStep` o sección de agent call
- [ ] W0.5: Leer `doc/DB_SCHEMA.md` — confirmar columnas de `agent_calls` y `agents`

### Wave 1 — DB + Schema Zod
- [ ] W1.1: Crear `supabase/migrations/056_output_schema.sql`
- [ ] W1.2: Actualizar `src/lib/schemas/model.schema.ts` — agregar `output_schema`
- [ ] Build gate: `npx tsc --noEmit` ✅

### Wave 2 — API validation (sandbox + compose)
- [ ] W2.1: `sandbox/invoke/route.ts` — agregar output validation post-agente (orden correcto)
- [ ] W2.2: `compose/route.ts` — agregar output validation post-step
- [ ] W2.3: `agents/[slug]/route.ts` + `agents/route.ts` — incluir `output_schema` en responses
- [ ] Build gate: `npx tsc --noEmit` ✅

### Wave 3 — UI + i18n
- [ ] W3.1: `Step3Technical.tsx` — textarea output_schema
- [ ] W3.2: `EditAgentForm.tsx` — field output_schema
- [ ] W3.3: `PublishForm.tsx` — incluir output_schema en PATCH
- [ ] W3.4: `messages/en.json` + `messages/es.json` — claves i18n
- [ ] Build gate: `npx tsc --noEmit` ✅
- [ ] W3.5: Aplicar migración en testnet + mainnet
- [ ] W3.6: Commit `feat(WAS-202): output schema validation antes de settlement`

---

## 7. Scope

**IN:**
- Migración DB (output_schema, result_type)
- Validación output en sandbox y compose
- UI para declarar output_schema (publish + edit)
- output_schema en API responses

**OUT:**
- Dashboard UI con conteo de schema_violation (AC-3 — solo columna DB, gráfica en sprint futuro)
- ZK validation (fuera de scope)
- Contratos on-chain

---

## 8. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Agentes existentes con output mal formado reciben refund inesperado | M | M | output_schema es null por defecto → sin impacto en agentes existentes (AC-3) |
| Orden de bloques incorrecto → cobro antes de validar | M | A | Documentado en 4.3/4.4, Builder debe seguir exactamente |

---

## 9. Dependencias

- Migración 055 debe aplicarse en testnet antes de Wave 2
- `metaValidateSchema` y `validateInput` ya existen — no hay pre-requisitos de código
