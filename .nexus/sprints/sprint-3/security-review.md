# Security Review — Sprint 3
**Reviewer:** Security Agent (NexusAgil v1.3)
**Fecha:** 2026-03-13
**Commits:** SSRF-002 (c301dba) · SCOPE-001 (fe4a148) · WAS-206 (67e0a8e) · WAS-202 (dde0987)

---

## Superficie de Ataque

| Superficie | Archivo | Auth requerida | Datos sensibles expuestos |
|---|---|---|---|
| Schema validator (metaValidate + validateInput) | `src/lib/schema-validator.ts` | N/A (lib) | No directamente |
| Compose pipeline API | `src/app/api/v1/compose/route.ts` | x-api-key (SHA-256) | step_outputs, endpoint_urls, agent costs |
| Sandbox invoke API | `src/app/api/v1/sandbox/invoke/[slug]/route.ts` | Supabase session (anon permitido) | output del agente, balance del usuario |
| IDOR pipeline fix (RPC) | `supabase/migrations/055_idor_pipeline_ownership.sql` | key_hash verificado en SQL | step_outputs (antes filtrado incorrecto) |
| Creator agent PATCH/DELETE | `src/app/api/creator/agents/[slug]/route.ts` | Supabase session + CSRF + ownership | input_schema, output_schema, endpoint_url |

---

## Findings

| ID | Severidad | Commit | Área | Título | Descripción | Recomendación |
|---|---|---|---|---|---|---|
| SEC-01 | **HIGH** | WAS-202 (dde0987) | B / E | `output_schema` e `input_schema` no pasan por `metaValidateSchema()` en el PATCH handler | `createModelSchema` usa `z.record(z.string(), z.unknown())` para ambos campos — cualquier JSON object pasa Zod. Un creador puede guardar `{"$ref": "//evil.com/schema"}`. En runtime, `validateInput()` llama `ajv.compile(malicious_schema)`, AJV lanza excepción por ref no resuelta, el `catch` retorna `null` → **validación de schema silenciosamente bypasseada** para todos los outputs de ese agente. Además, si en algún futuro se agrega un cargador de URIs a AJV, se abre SSRF. | Llamar `metaValidateSchema(body.input_schema)` y `metaValidateSchema(body.output_schema)` **antes** del `serviceClient.update()` en el PATCH handler. Retornar 422 si invalid. Aplica también al handler de registro de agentes. |
| SEC-02 | **MEDIUM** | SSRF-002 (c301dba) | E | Protocol-relative URL bypass en `findExternalRefs` | `ref.includes('://')` bloquea `http://`, `https://`, `ftp://`, `file://`, etc. Pero **NO bloquea `//evil.com/schema`** (protocol-relative URL). Si AJV u otro procesador resuelve `//evil.com` como `https://evil.com`, habría SSRF. Actualmente AJV sin cargador URI lanza error (mitigado), pero el bypass existe para futuras rutas de código o librerías que procesen el schema. | Añadir check explícito: `ref.startsWith('//')`. Queda así: `ref.includes('://') \|\| ref.startsWith('data:') \|\| ref.startsWith('//')`. Cero impacto en schemas legítimos. |
| SEC-03 | **LOW** | WAS-202 (dde0987) | F | `SELECT *` implícito en response de PATCH `/creator/agents/[slug]` | El PATCH devuelve `{ agent }` con `.select()` sin proyección explícita — retorna **todas las columnas** del agente incluyendo `endpoint_url`, `input_schema`, `output_schema`, columnas internas. Aunque el owner puede ver sus propios datos, reduce la superficie de exposición accidental. | Cambiar `.select()` por `.select('id, slug, name, description, category, status, price_per_call, ...')` con las columnas necesarias para el cliente. |
| SEC-04 | **LOW** | WAS-202 (dde0987) | C | `output_schema_violation` expone el error de AJV al caller externo | Cuando el output del agente viola el schema, `validateInput()` retorna `ajv.errorsText(validate.errors)` que puede incluir paths y valores del output del agente. El error llega en el JSON response al caller de la API. | Retornar un mensaje genérico (`"Output does not match declared schema"`) en lugar del error de AJV completo en producción. Loggear el detalle internamente. |
| SEC-05 | **LOW** | WAS-206 (67e0a8e) | D | `FOR UPDATE` en `get_pipeline_for_retry` sin timeout de lock | La función RPC usa `FOR UPDATE` para evitar condiciones de carrera en retry. Si otra transacción mantiene el lock, la RPC puede quedar bloqueada indefinidamente. No es SSRF/IDOR pero puede usarse para DoS (lock contention). | Agregar `NOWAIT` o `SKIP LOCKED` + manejo de error `55P03` en el caller, o usar `FOR UPDATE NOWAIT` y capturar excepción en PL/pgSQL. |
| SEC-06 | **INFO** | SSRF-002 (c301dba) | E | `data:` bloqueado — correcto | Bloquear `data:` en `$ref`/`$schema` previene esquemas con data URIs que podrían evadir controles. Correctamente implementado. | — |
| SEC-07 | **INFO** | WAS-206 (67e0a8e) | D | `SECURITY DEFINER` justificado y correctamente restringido | La función necesita JOIN sobre `agent_keys` (protegida por RLS). `SECURITY DEFINER` + `SET search_path = public` previene search_path hijacking. `REVOKE FROM PUBLIC` + `GRANT TO service_role` limitan ejecución a contexto server-side. Correctamente implementado. | — |
| SEC-08 | **INFO** | SCOPE-001 (fe4a148) | A | Cambio semántico sin impacto de seguridad | El cambio de error code `no_agent_match` → `scope_violation` cuando `fallback_slug` existe pero está fuera de scope es puramente informativo. La lógica de autorización no cambia — la ejecución se bloquea en ambos casos. | — |
| SEC-09 | **INFO** | WAS-202 (dde0987) | A | Auth correcta en sandbox para usuarios anónimos | Los usuarios anónimos pasan por rate-limit por IP+UA antes de invocar agentes. El balance check y deducción se omite correctamente (no tienen cuenta). La carga al agente externo procede pero el creador no cobra por calls anónimos — comportamiento esperado por diseño. | Verificar que el agente no reciba créditos de la sandbox call anónima (confirmar que `amount_paid: agent.price_per_call` en el insert de `agent_calls` para anónimos es correcto o debe ser 0). |
| SEC-10 | **INFO** | WAS-202 (dde0987) | B | Input validation (input_schema) ocurre antes de cobro — correcto | En sandbox y compose, `validateInput(agent.input_schema, input)` se llama antes de `deduct_*_balance`. Output validation ocurre después de llamar al agente pero antes de confirmar el pago. Orden correcto para evitar cobros por validaciones fallidas. | — |

---

## Detalle Crítico: SEC-01 — Schema bypass por falta de meta-validación

```typescript
// PATCH /api/creator/agents/[slug] — FLUJO ACTUAL (VULNERABLE)
const result = updateSchema.safeParse(body)   // ✅ Zod: acepta cualquier Record<string,unknown>
// ❌ FALTA: metaValidateSchema(result.data.output_schema)
await serviceClient.from('agents').update({ ...result.data })  // schema malicioso guardado en DB

// Después, en compose/sandbox:
const outputErr = validateInput(agent.output_schema, stepOutput)
// → ajv.compile({ "$ref": "//evil.com" }) → throws → catch → return null
// → validación silenciosa bypasseada, cualquier output "válido"
```

**Fix mínimo en `src/app/api/creator/agents/[slug]/route.ts`:**
```typescript
import { metaValidateSchema } from '@/lib/schema-validator'

// Después de result.success:
if (result.data.input_schema) {
  const metaCheck = metaValidateSchema(result.data.input_schema)
  if (!metaCheck.valid) return NextResponse.json({ error: metaCheck.error, code: 'invalid_input_schema' }, { status: 422 })
}
if (result.data.output_schema) {
  const metaCheck = metaValidateSchema(result.data.output_schema)
  if (!metaCheck.valid) return NextResponse.json({ error: metaCheck.error, code: 'invalid_output_schema' }, { status: 422 })
}
```

---

## Detalle: SEC-02 — Protocol-relative URL bypass

```typescript
// ACTUAL (puede bypassearse con //evil.com)
if (ref.includes('://') || ref.startsWith('data:')) { ... }

// FIX:
if (ref.includes('://') || ref.startsWith('data:') || ref.startsWith('//')) { ... }
```

---

## Veredicto

| Commit | Estado | Bloqueante |
|---|---|---|
| SSRF-002 (c301dba) — schema-validator.ts | ⚠️ Aprobado con observaciones | No (mitigado en runtime, fix recomendado) |
| SCOPE-001 (fe4a148) — compose/route.ts | ✅ Aprobado | No |
| WAS-206 (67e0a8e) — IDOR fix | ✅ Aprobado | No |
| WAS-202 (dde0987) — output schema validation | ❌ **Requiere fix antes de merge** | **Sí — SEC-01** |

### Resumen ejecutivo

Los cambios de WAS-206 (IDOR fix) y SCOPE-001 están correctamente implementados y no introducen vulnerabilidades. El SSRF-002 mejora la cobertura de protocolos pero tiene un gap menor con protocol-relative URLs (SEC-02, mitigado actualmente).

**El blocker real es WAS-202:** `output_schema` e `input_schema` son aceptados por el PATCH handler sin pasar por `metaValidateSchema()`. Esto permite que un creador guarde schemas inválidos o maliciosos que: (a) silenciosamente bypasean la validación en runtime, y (b) crean una precondición para SSRF si AJV obtiene un cargador de URIs externas en el futuro. Fix estimado: ~10 líneas en el PATCH handler.

**Acción requerida:**
1. 🔴 **SEC-01** — Fix `metaValidateSchema` en PATCH handler antes de merge (WAS-202)
2. 🟡 **SEC-02** — Añadir `|| ref.startsWith('//')` en `findExternalRefs` (SSRF-002)
3. 🟢 **SEC-03, SEC-04, SEC-05** — Mejoras opcionales, no bloqueantes
