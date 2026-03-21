# Security Review — SDD #261/#262 (Onboard Input Schema + Multi-Agent)

**Reviewer:** Security Reviewer (NexusAgil v1.3)
**Branch:** `improvement/261-262-onboard-input-schema-multi-agent`
**Commit:** `c5fea4a35`
**Date:** 2026-03-20

---

## Veredicto: 🔴 BLOCKER (1 hallazgo crítico) + 2 Medium + 1 Low

---

## A. Auth/Authorization (SDD #262)

### A1. Session hijacking via UUID guessing — **LOW RISK ✅**

> *Si alguien adivina el session_id UUID, ¿puede insertar un agente con cualquier owner_id?*

**Riesgo real: bajo.** UUIDv4 tiene 122 bits de entropía (~5.3×10³⁶ posibilidades). Fuerza bruta es inviable. Además, las sesiones expiran (`expires_at` se valida en cada step). Un atacante necesitaría:
1. Adivinar un UUID activo no expirado (inviable)
2. Conocer el step actual de la sesión
3. Completar todos los pasos restantes con datos válidos

**Sin embargo**, si el `session_id` se filtra (logs, URLs, respuestas HTTP a terceros), el atacante **sí** podría completar el wizard con el `owner_id` preinyectado. Recomendación menor: considerar añadir un session token/secret separado del session_id para operaciones de escritura.

**Veredicto: PASS** — riesgo aceptable dado UUIDv4 + expiración.

### A2. owner_id no re-validado en step/route.ts — **MEDIUM ⚠️**

> *El owner_id se valida en start contra la DB, pero en step se usa directo de session.data.*

**Análisis:** El `owner_id` se almacena en `onboarding_sessions.data` (JSONB) en el `start`. En `step/route.ts` se usa `data.owner_id` directamente para el insert del agente sin re-verificar que:
1. El owner sigue existiendo
2. La agent_key que originó el owner_id sigue activa

**Escenario de ataque:** Un administrador revoca/desactiva una agent_key. Una sesión de onboarding creada *antes* de la revocación puede seguir completándose y registrar un agente bajo ese owner_id.

**Ventana de ataque:** Limitada al TTL de la sesión (presumiblemente horas).

**Recomendación:** Re-validar `owner_id` en step 7 antes del insert:
```typescript
// En step 7, antes del insert del agente:
const { data: ownerCheck } = await serviceClient
  .from('creator_profiles')
  .select('id')
  .eq('id', data.owner_id)
  .single()
if (!ownerCheck) {
  return NextResponse.json({ error: 'Owner no longer valid' }, { status: 403 })
}
```

**Veredicto: MEDIUM** — ventana estrecha pero fix trivial.

### A3. Rate limiting con x-agent-key / brute force — **LOW ✅**

> *¿SHA-256 protege contra fuerza bruta de keys? ¿Se loggean intentos fallidos?*

**Análisis:**
- El rate limit de 5/hora por IP aplica a `/onboard/start` **incluyendo** requests con `x-agent-key`. ✅
- SHA-256 de la key se compara contra `key_hash` en DB. No se almacena la key en claro. ✅
- Las keys generadas por `generateApiKey()` usan `randomBytes` — alta entropía. ✅
- **Intentos fallidos NO se loggean** — el endpoint retorna 401 silenciosamente.

**Recomendación:** Añadir logging de intentos fallidos (sin incluir la key):
```typescript
if (!keyRow) {
  console.warn('[onboard/start] invalid agent key attempt', { ip })
  return NextResponse.json(...)
}
```

**Veredicto: PASS** — SHA-256 + alta entropía + rate limit por IP es suficiente. Log de fallidos es mejora operativa.

---

## B. Input Validation (SDD #261)

### B1. 🔴 BLOCKER — input_schema NO pasa por metaValidateSchema en onboard wizard

**Hallazgo crítico:** En `step/route.ts` (step 7), el `input_schema` se valida solo como "objeto JSON no nulo con al menos una propiedad". **No se llama `metaValidateSchema()`**, que es la función que:
1. Bloquea `$ref` con URLs externas (prevención SSRF)
2. Meta-valida que sea JSON Schema draft-07 válido

En contraste, `/api/v1/agents/register/route.ts` **sí** llama `metaValidateSchema()` correctamente.

**Vector de ataque:**
```json
{
  "type": "object",
  "properties": {
    "data": { "$ref": "http://169.254.169.254/latest/meta-data/iam/security-credentials/" }
  }
}
```
Este schema pasaría la validación del wizard y se almacenaría en `agents.input_schema`. Si algún proceso posterior resuelve `$ref` (e.g., validación de inputs en runtime con AJV), se produce SSRF.

**Fix requerido:**
```typescript
// step/route.ts, case 7, después de parsear el schema:
import { metaValidateSchema } from '@/lib/schema-validator'

const schemaResult = metaValidateSchema(parsed)
if (!schemaResult.valid) {
  return NextResponse.json({ error: schemaResult.error }, { status: 400 })
}
```

**Veredicto: 🔴 BLOCKER — debe resolverse antes de merge.**

### B2. Prototype pollution via input_schema — **LOW ✅**

**Análisis:** El schema llega como JSON parseado (`JSON.parse` o directo del body de Next.js). `JSON.parse` en V8 **no** produce objetos con `__proto__` como key funcional — las claves `__proto__` quedan como propiedades normales sin afectar el prototipo. `buildExampleFromSchema` itera con `Object.entries()` que es seguro.

**Veredicto: PASS** — sin riesgo de prototype pollution via JSON.parse estándar.

### B3. SSRF via URLs en el schema (no $ref) — **PASS ✅**

Las URLs en `description` o valores string del schema son datos inertes — `buildExampleFromSchema` solo genera strings estáticas basadas en heurísticas, nunca hace fetch de URLs del schema.

**Veredicto: PASS.**

---

## C. Datos Sensibles

### C1. agent_key raw en respuesta — **PASS ✅**

La respuesta del wizard retorna `agent_key: raw` en texto claro. Verificado:
- **No se loggea** — no hay `console.log/error/warn` que incluya `raw` o `agent_key` en las rutas de onboard.
- El `agent_key_warning` indica que no se mostrará de nuevo. ✅
- Es el mismo patrón que el flujo existente (step 8 / email flow). ✅

**Veredicto: PASS.**

---

## E. Rate Limiting

### E1. Rate limit aplica al flujo x-agent-key — **PASS ✅**

El rate limit `5/hora por IP` se ejecuta **antes** de verificar `x-agent-key` en `start/route.ts`. Un atacante no puede bypassear el rate limit con una key válida.

**Nota:** No hay rate limit en `/onboard/step`. Un atacante con un `session_id` válido podría hacer muchos requests al step endpoint. Esto es bajo riesgo dado que cada step avanza el estado y no se puede "retroceder".

**Veredicto: PASS.**

---

## Resumen de Hallazgos

| ID | Severidad | Componente | Hallazgo | Estado |
|----|-----------|------------|----------|--------|
| B1 | 🔴 BLOCKER | step/route.ts | `input_schema` no pasa por `metaValidateSchema` — bypass de protección SSRF via `$ref` | **DEBE FIXEARSE** |
| A2 | ⚠️ MEDIUM | step/route.ts | `owner_id` no re-validado antes del insert en step 7 | Recomendado |
| A3-log | 💡 LOW | start/route.ts | Intentos fallidos de agent-key no se loggean | Mejora operativa |
| A1 | ✅ LOW | Diseño | Session hijack via UUID guessing | Riesgo aceptable |

---

## Acción Requerida

1. **🔴 BLOCKER B1:** Añadir `metaValidateSchema(parsed)` en step 7 de `step/route.ts` antes de guardar el schema. Sin este fix, **no se debe mergear**.
2. **⚠️ A2:** Re-validar `owner_id` en step 7 (fix de 5 líneas).
3. **💡 A3-log:** Añadir `console.warn` en intentos fallidos de agent-key.
