# Logic Audit — Sprint 9

**Auditor:** NexusAgil Logic Auditor  
**Fecha:** 2026-03-15  
**Commits auditados:** 5 (19bec8e, f755ef4, 30aa15f, 60130a1, 6278a85)

---

## DEUDA-02 — Handle Supabase errors + try/catch in API endpoints

| AC | Status | Archivo:Línea | Detalle |
|----|--------|---------------|---------|
| AC-1/2/3: Supabase error → 503 | ✅ PASS | `agents/[slug]/route.ts:46` | `if (error && error.code !== 'PGRST116')` → 503 correcto |
| AC-4: slug not found → 404 | ✅ PASS | `agents/[slug]/route.ts:54` | `if (!agent)` → 404 con CORS |
| AC-5: CORS en errores [slug] | ✅ PASS | `agents/[slug]/route.ts:14-18` | Const CORS aplicado en todas las respuestas de error |
| AC-6: console.error antes de 503 [slug] | ✅ PASS | `agents/[slug]/route.ts:47` | `console.error('[agents/slug] Supabase error:', error.message)` |
| AC-1/2/3: Supabase error → 503 [list] | ✅ PASS | `agents/route.ts:198` | try/catch + `if (error)` → 503 con CORS |
| AC-5: CORS en errores [list search path] | ✅ PASS | `agents/route.ts:82` | `{ 'Access-Control-Allow-Origin': '*' }` en error |
| AC-5: CORS en errores [discover] | ✅ PASS | `agents/discover/route.ts:53-56` | CORS aplicado en error responses |
| **BUG-DEUDA02-01**: slim path sin error check | ⚠️ WARN | `agents/route.ts:127` | `const { data: slimData, count: slimCount } = await slimQuery` — no se desestructura `error`. Si Supabase falla en slim mode, devuelve 200 con `agents: []` en lugar de 503. No bloquea AC directos de DEUDA-02 pero es regresión de comportamiento. |
| **BUG-DEUDA02-02**: discover success sin CORS | ⚠️ WARN | `agents/discover/route.ts:65` | El `return NextResponse.json({ agents, total, meta })` final **no incluye** headers CORS. Las respuestas exitosas de `/discover` serían bloqueadas por CORS en browsers. Preexistente pero no corregido. |

**Veredicto: APROBADO CON ADVERTENCIAS** — Los ACs específicos de DEUDA-02 están cubiertos. Dos bugs colaterales identificados (slim sin error-check, discover success sin CORS) que deberían corregirse.

---

## WAS-206 — buildExampleFromSchema + preview en publish form

| AC | Status | Archivo:Línea | Detalle |
|----|--------|---------------|---------|
| AC-1: preview en tiempo real | ✅ PASS | `Step3Technical.tsx:onChange textarea` | `buildExampleFromSchema(parsed)` llamado en cada keystroke válido de JSON, actualiza `inputExampleRaw` |
| AC-2: string con description → valor real | ✅ PASS | `buildExampleFromSchema.ts:inferStringValue` | Usa heurísticas por key/description, devuelve valores como `'Hello world'`, `'user@example.com'` — nunca la descripción literal |
| AC-3: string sin description → `""` | ✅ PASS | `buildExampleFromSchema.ts:38` | `return ''` como fallback en `inferStringValue` |
| AC-4: campos no en required[] → omitidos | ✅ PASS | `buildExampleFromSchema.ts:58` | `if (required && !required.includes(key)) continue` |
| AC-4b: required[] ausente → incluir todos | ✅ PASS | `buildExampleFromSchema.ts:55` | `const required = schema.required // undefined = incluir todos` |
| AC-5/6: ejemplo guardado como `metadata.input_example` | 🔴 BLOQUEANTE | `PublishForm.tsx:179` + `resolveExampleInput.ts:25` | **MISMATCH CRÍTICO**: PublishForm envía `input_example` como campo top-level en PATCH body. El PATCH handler hace `update({ ...result.data })` que escribe en columna `input_example` de la tabla agents. Sin embargo, `resolveExampleInput` lee de `agent.metadata?.input_example`. El slug route selecciona `metadata` (JSONB) pero NO `input_example` como columna directa. El ejemplo guardado por el creator NUNCA es leído por `resolveExampleInput`. Además, no existe migración para columna `input_example`. |
| AC-8: matching case-insensitive | ✅ PASS | `buildExampleFromSchema.ts:25` | `\`${key} ${description ?? ''}\`.toLowerCase()` |
| AC-9: campo con enum → enum[0] | ✅ PASS | `buildExampleFromSchema.ts:43` | `if (prop.enum && prop.enum.length > 0) return prop.enum[0]` |
| **BUG-206-01**: `__OMIT__` puede omitir campos required | ⚠️ WARN | `buildExampleFromSchema.ts:28-30` | Si un campo **requerido** tiene "optional" en su description, `inferStringValue` devuelve `__OMIT__` ignorando que required[] lo incluye. La heurística sobreescribe la lógica de required. |

**Veredicto: BLOQUEANTE** — AC-5/6 no implementado. El ejemplo generado en publish jamás llega a `resolveExampleInput` porque se almacena en columna equivocada o no-existente. Requiere: (a) migración de columna `input_example` o (b) guardar en `metadata` JSONB y actualizar el SELECT del slug route para incluir `metadata.input_example`.

---

## DEUDA-01 — expose resolved example_input en agents API

| AC | Status | Archivo:Línea | Detalle |
|----|--------|---------------|---------|
| AC-1: GET /agents/{slug} incluye example_input | ✅ PASS* | `agents/[slug]/route.ts:94` | `example_input: resolveExampleInput(agent)` — el slug route SÍ selecciona `metadata`, capabilities, input_schema. Funciona para fuentes 2 y 3 (capabilities + schema). Fuente 1 (metadata.input_example) rota por BUG-206-01. |
| AC-2: GET /agents (list) incluye example_input | ⚠️ PARCIAL | `agents/route.ts:238` | `example_input: resolveExampleInput(agent)` — el list route **no selecciona `metadata`** en su query principal. `agent.metadata` es `undefined`. Solo funciona con capabilities y buildExampleFromSchema. |
| AC-2: slim mode example_input | ⚠️ PARCIAL | `agents/route.ts:132` | slim query no selecciona `metadata`, `capabilities`, ni `input_schema`. `resolveExampleInput` siempre devuelve `EXAMPLE_FALLBACK = '{"input": ""}'` en slim mode. |
| AC-3: JSON inválido → descartar | ✅ PASS | `resolveExampleInput.ts:10-12` | `isValidJson` con try/catch |
| AC-3b: capabilities vacío → no excepción | ✅ PASS | `resolveExampleInput.ts:22` | `agent.capabilities?.[0]?.example_input` — optional chaining seguro |
| AC-4: `{}` vacío → fallback | ✅ PASS | `resolveExampleInput.ts:31` + `buildExampleFromSchema.ts:83` | `buildExampleFromSchema({})` → null → EXAMPLE_FALLBACK |
| AC-5: example_input nunca null | ✅ PASS | `resolveExampleInput.ts:35` | Siempre retorna EXAMPLE_FALLBACK como último recurso |
| AC-2: search path example_input | ✅ PASS | `agents/route.ts:95` | search path sí incluye `resolveExampleInput(agent)` |

**Veredicto: APROBADO CON ADVERTENCIAS** — AC-5 (nunca null) garantizado. AC-1 funcional parcialmente (no refleja input_example del creator por BUG-206-01). AC-2 funcional para list completo pero no para slim mode (EXAMPLE_FALLBACK fijo). No es bloqueante per se para DEUDA-01 ya que los ACs no mencionan slim mode explícitamente, pero la experiencia es degradada.

---

## DEUDA-03 — NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA en .env.example

| Verificación | Status | Detalle |
|---|---|---|
| Variable documentada en .env.example | ✅ PASS | `.env.example` contiene `NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=false` |
| Verificación en Vercel | ⚠️ NO VERIFICABLE | No se puede acceder a Vercel dashboard desde esta auditoría. Requiere confirmación manual. |
| Variable usada correctamente en código | ✅ PASS | `Step3Technical.tsx` usa `process.env.NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA === 'true'` en dos lugares |

**Veredicto: APROBADO** — Variable documentada y usada. Verificación Vercel requiere confirmación manual del team.

---

## WAS-205 — Dynamic API fetch en Sandbox y TryIt

| AC | Status | Archivo:Línea | Detalle |
|----|--------|---------------|---------|
| AC-1: textarea Sandbox pre-cargado al seleccionar | ✅ PASS | `SandboxClient.tsx:fetchAgents` | `fetchExampleInput(firstSlug)` llamado después de cargar agentes |
| AC-2: fetch dinámico al cambiar select | ✅ PASS | `SandboxClient.tsx:handleSlugChange` | `void fetchExampleInput(newSlug)` + reset dirty |
| AC-3: TryIt pre-cargado con ejemplo real | ✅ PASS | `TryIt.tsx:useEffect` | `fetchAndSetPayload(firstSlug)` llamado en mount |
| AC-7: API down → fallback sin bloquear UI | ✅ PASS | `SandboxClient.tsx:catch` + `TryIt.tsx:catch` | Ambos hacen catch silencioso con fallback `'{"input": ""}'` |
| Constraint: dirty-flag en Sandbox | ✅ PASS | `SandboxClient.tsx:fetchExampleInput` | `fetchExampleInput` es `useCallback([inputDirty])` y chequea `!inputDirty` antes de sobreescribir |
| Constraint: dirty-flag en TryIt | ⚠️ WARN | `TryIt.tsx:fetchAndSetPayload` | **Stale closure bug**: `fetchAndSetPayload` no es `useCallback` — captura `payloadDirty` del render actual. En `handleSlugChange`: llama `setPayloadDirty(false)` y luego `fetchAndSetPayload(newSlug)` síncronamente. La función asíncrona cierra sobre `payloadDirty` del render PRE-reset (puede ser `true`). Si el usuario editó y luego cambió de agente, el ejemplo nuevo NO se carga porque `!payloadDirty` evalúa con el valor stale `true`. El dirty-flag se resetea visualmente pero la carga falla. |
| **BUG-205-01**: Sandbox fetchExampleInput memoization | ⚠️ WARN | `SandboxClient.tsx:fetchAgents` | `fetchExampleInput` depende de `inputDirty` via `useCallback`. Dentro de `fetchAgents` (que también es `useCallback` con deps `[selectedSlug, fetchExampleInput]`), la referencia a `fetchExampleInput` se actualiza al cambiar `inputDirty`. Sin embargo, si el usuario edita y las dependencias de `fetchAgents` NO cambian, la stale `fetchExampleInput` con dirty=false del mount se retiene. En el primer agente seleccionado esto es OK. El riesgo es bajo pero presente. |
| Hardcoded EXAMPLE_PAYLOADS eliminados | ✅ PASS | Ambos archivos — no queda ninguna referencia a `EXAMPLE_PAYLOADS` |

**Veredicto: APROBADO CON ADVERTENCIAS** — ACs cubiertos. Bug de stale closure en TryIt puede causar que el ejemplo no se cargue al cambiar agente después de editar; no viola el constraint (no sobreescribe edición) pero impide cargar nuevo ejemplo. Recomendado wrap de `fetchAndSetPayload` con `useCallback([payloadDirty])`.

---

## Veredicto Global

**BLOQUEANTE** — Por los siguientes issues:

1. **[WAS-206 AC-5/6] CRÍTICO**: `input_example` guardado en columna equivocada (o inexistente). `resolveExampleInput` lee de `metadata.input_example` pero el PATCH escribe a columna directa `input_example`. La feature de preview del publish form funciona pero el valor nunca persiste de forma recuperable por la API. Requiere migración DB + fix en SELECT o cambio de estrategia de almacenamiento.

### Issues no bloqueantes (deben corregirse antes de release):

- **DEUDA-02/slim**: slim path no maneja error de Supabase → silently returns 200 empty
- **DEUDA-02/discover**: success response de `/discover` sin CORS headers → falla en browsers
- **DEUDA-01/AC-2**: list route no selecciona `metadata` → no puede usar creator's input_example aunque se corrija el storage bug
- **WAS-205/TryIt**: stale closure en `fetchAndSetPayload` → ejemplo no carga al cambiar agente post-edición
- **WAS-206/BUG-01**: `__OMIT__` heuristic puede excluir campos requeridos si description contiene "optional"
