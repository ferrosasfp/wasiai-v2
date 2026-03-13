## Logic Audit — Sprint 2 WasiAI

> Auditor: NexusAgile Logic Auditor v1.3
> Fecha: 2026-03-13
> Archivos auditados: `scope-check.ts`, `agent-discovery.ts`, `schema-validator.ts`, `compose/route.ts`, `sandbox/invoke/[slug]/route.ts`, `agent-keys.service.ts`, `052_pipeline_step_outputs.sql`

| #  | Issue   | AC   | Severidad | Hallazgo |
|----|---------|------|-----------|----------|
| L1 | WAS-186 | AC-3 | INFO      | ✅ OR logic correcta. `isAgentInScope` retorna `true` si `allowedSlugs.includes(agentSlug)` OR `allowedCategories.includes(agentCategory)`. Implementación fiel al spec. |
| L2 | WAS-186 | AC-4 | INFO      | ✅ `compose/route.ts` retorna `{ error: 'Agent not in key scope', code: 'scope_violation', slug }` con HTTP 403 cuando `isAgentInScope` devuelve false. Correcto. |
| L3 | WAS-186 | AC-5 | INFO      | ✅ `if (!allowedSlugs && !allowedCategories) return true` — key sin scope otorga acceso total. Backward-compatible y correcto. |
| L4 | WAS-196 | AC-3 | INFO      | ✅ Sandbox route retorna exactamente `{ error: "Sandbox disabled by creator", code: "sandbox_disabled" }` con HTTP 403 cuando `agent.sandbox_enabled === false`. |
| L5 | WAS-196 | AC-5 | N/A       | ⚠️ No verificable con los archivos provistos. El listing de agentes no está entre los archivos auditados. Requiere revisión de la query del endpoint de listing (no incluido en scope). |
| L6 | WAS-204 | AC-3 | INFO      | ✅ SQL RPC `get_pipeline_for_retry` hace JOIN con `agent_keys` y compara `ak.key_hash = p_key_hash`, devolviendo `owned_by_key` boolean. Compose verifica `if (!pipeline.owned_by_key)` → 403. Correcto. |
| L7 | WAS-204 | AC-5 | INFO      | ✅ En el loop de compose, cuando `resumedFromStep !== undefined && globalStepIndex < resumedFromStep` → `continue` sin llamar `executeStep`. Los steps previos se saltan sin deducción de balance. |
| L8 | WAS-204 | AC-9 | INFO      | ✅ La función SQL `get_pipeline_for_retry` termina con `FOR UPDATE`. Previene race conditions en retry concurrente. |
| L9 | WAS-200 | AC-3 | INFO      | ✅ `findExternalRefs` recorre recursivamente el schema (objects y arrays) y bloquea cualquier `$ref` que comience con `http://` o `https://`. Implementación recursiva correcta. |
| L10 | WAS-200 | AC-6 | **HIGH**  | 🐛 **BUG en sandbox route**: la validación de input_schema ocurre en el paso 8 (después del parse de body), pero `deduct_sandbox_balance` ya fue ejecutado en el paso 6. Si la validación falla, se retorna 422 **sin hacer refund** del balance deducido. El usuario pierde créditos de sandbox por input inválido. En `compose/route.ts` el orden es correcto (validación antes de `executeStep` → antes de `deduct_key_balance`), pero la sandbox route viola el AC. |
| L11 | WAS-200 | AC-7 | INFO      | ✅ `validateInput` retorna `null` inmediatamente si `schema === null || schema === undefined`. Comportamiento sin-validación confirmado. |
| L12 | WAS-187 | AC-2 | INFO      | ✅ `discoverAgent` usa `.contains('capabilities', JSON.stringify([{ name: capability }]))` — JSONB containment operator correcto para buscar por nombre de capability. |
| L13 | WAS-187 | AC-3 | INFO      | ✅ `validateSteps` en compose retorna error `"capability and agent_slug are mutually exclusive"` cuando ambos están presentes → HTTP 400. |
| L14 | WAS-187 | AC-7 | INFO      | ✅ `discoverAgent` filtra candidatos con `isAgentInScope(a.slug, a.category, allowedSlugs, allowedCategories)` antes de retornar. El agente descubierto pasa por el scope check de WAS-186. |

---

## Detalle Bug Crítico — L10 (WAS-200 AC-6, Sandbox Route)

**Ubicación:** `src/app/api/v1/sandbox/invoke/[slug]/route.ts`

**Orden actual:**
```
paso 6 → deduct_sandbox_balance()   ← dinero deducido
paso 8 → parseBody()
         validateInput(schema, input)  ← si falla → return 422 SIN refund
```

**Orden correcto (AC-6):**
```
paso 6b → parseBody()
          validateInput(schema, input)  ← si falla → return 422 (sin cargo)
paso 7  → deduct_sandbox_balance()
```

**Fix sugerido:** mover el bloque de parse + validación de input (pasos 8 y WAS-200) a **antes** del bloque `if (!isAnonymous)` de deducción, o bien añadir un `refund_sandbox_balance` en el branch de error de validación.

---

### Veredicto: BLOQUEANTE

**1 bug HIGH** impide el release: `WAS-200 AC-6` en sandbox route descuenta balance antes de validar el input, sin refund en caso de fallo de validación. El AC exige explícitamente que la validación ocurra antes de `deduct_key_balance`.

**1 AC no verificable**: `WAS-196 AC-5` (listing visibility) — requiere auditar el endpoint de listing de agentes, no incluido en el scope de archivos provistos. Debe verificarse por separado.

Los demás 12 ACs verificados están correctamente implementados.
