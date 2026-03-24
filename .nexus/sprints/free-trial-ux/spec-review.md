# Spec Review — SDD: Free Trial UX (Sandbox + A2A + Zero Duplicación)

> Reviewer: Spec Reviewer subagent
> Fecha: 2026-03-23
> SDD: `.nexus/sprints/free-trial-ux/sdd.md`

---

## Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 — ¿Fix ya existe? | ✅ NO existe | Route C sigue presente en `invoke/route.ts` (líneas ~272-360). SDD aplica. |
| 0.2 — ¿Archivos referenciados existen? | ✅ Todos existen | `invoke/route.ts`, `trial/route.ts`, `payment-type.ts`, `AgentTrialPlayground.tsx` — todos leídos. |
| 0.3a — ¿Código compila contra tipos reales? | ⚠️ 2 issues | Ver Findings #1 y #2 |
| 0.3b — ¿Encoding DB correcto? | ❌ FALLA | `metadata.example_output` NO existe en DB — campo real es `metadata.input_example`. Además, `metadata` y `capabilities` no están en el SELECT de invoke/POST. Ver Findings #3 y #4. |
| 0.4 — ¿Dependencias resueltas? | ✅ OK | `sandbox_enabled` ✅ en DB, `payment_type:'sandbox'` ✅ en validator, `use_trial` RPC ✅ usado en trial/route.ts, `free_trial_enabled/limit` ✅ en DB. |
| 0.5 — ¿SDD completo? | ⚠️ 2 ambigüedades | `build402Instructions()` no recibe `slug` (Finding #1). Flujo sandbox sin body no está cubierto (Finding #5). |

---

## Coherencia SDD

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ✅ OK | AC-1/8 → Wave 1, AC-2/3/4/6/7 → Wave 2. Todos los ACs tienen wave asignada. |
| No hay waves huérfanas | ✅ OK | Wave 0 (pre-flight), Wave 1, Wave 2. Todas con ACs asignados. |
| Build gates en cada wave | ✅ OK | Wave 1: `tsc --noEmit`. Wave 2: `tsc --noEmit` + `eslint --max-warnings 0`. |
| Rollback ejecutable | ✅ OK | `git revert <commit-wave-N>` — ejecutable sin necesidad de migraciones. |
| Constraints PROHIBIDO (mínimo 3) | ✅ OK | "Dos paths de free trial", "Exponer endpoint_url", "Sandbox sin rate limit", "Romper AgentTrialPlayground" — 4 prohibiciones explícitas. |

---

## Findings

| # | Severidad | Detalle | Corrección |
|---|-----------|---------|------------|
| 1 | 🔴 CRÍTICO | **`build402Instructions()` no puede incluir `slug`**: la función actual recibe `(model, priceStr, resourceUrl)`. El SDD ordena agregar `"/api/v1/agents/${slug}/trial"` al JSON, pero `slug` no es parámetro de la función. El `model.slug` está disponible en `model`, pero el SDD no menciona esto — ambiguo para el Builder. | Aclarar en SDD: usar `model.slug as string` dentro de `build402Instructions()` para construir el trial endpoint. No se necesita parámetro adicional. |
| 2 | 🔴 CRÍTICO | **`metadata.example_output` no existe en DB**: la DB retorna `metadata.input_example` (no `example_output`). El SDD especifica `agent.metadata?.example_output` para obtener el sandbox output. Código resultante siempre iría al fallback. | Corregir en SDD: usar `agent.metadata?.example_output ?? agent.metadata?.input_example` para backward compat, o documentar que el campo correcto en `metadata` es `input_example`. |
| 3 | 🔴 CRÍTICO | **`metadata` y `capabilities` no están en el SELECT de `invoke/POST`**: el SELECT actual de `invoke/route.ts` es `'id, slug, status, name, endpoint_url, ..., sandbox_enabled'` — no incluye `metadata` ni `capabilities`. El SDD pide agregar sandbox shortcut en Wave 1 usando `model.metadata?.example_output ?? model.capabilities?.[0]?.example?.output`, pero ambos campos son `undefined` en runtime. | Agregar `metadata, capabilities` al SELECT de invoke/POST en Wave 1. Explicitarlo en el SDD. |
| 4 | 🔴 CRÍTICO | **Sandbox sin body falla Zod ANTES de llegar al sandbox path**: el flujo de `trial/route.ts` valida el body en el paso 3, ANTES de buscar el agente (paso 4) y del sandbox check (post-agente). Si el caller envía `X-Sandbox: true` sin body (o con `{}`), `NativeBody.refine` falla con error `'Body must not be empty'` → responde 400 `invalid_input` antes de llegar al sandbox handler. AC-6 dice "no requiere body si sandbox header presente" pero el SDD no reordena el flujo. | El SDD debe especificar que la detección de sandbox (header `X-Sandbox: true`) ocurra ANTES de la validación Zod, o que el schema permita body vacío cuando el header sandbox esté presente. |
| 5 | 🟡 ALTO | **AgentTrialPlayground rompería con body nativo**: AC-7 dice "no romper frontend". El componente hace `setOutput(data.output ?? '')` — espera `output` como `string`. Tras AC-2, si el upstream retorna JSON, `output` será `object`. `CopyableOutput` recibiría un objeto en lugar de string, comportamiento indefinido. El SDD pone `AgentTrialPlayground.tsx` en "Archivos que NO se tocan" — pero el cambio de tipo de `output` sí impacta. | El SDD debe clarificar que la serialización del output en trial/route.ts siempre retorne `output` como string (ej: `JSON.stringify(parsed)` si es objeto) para mantener invariante del frontend. O aceptar que el frontend necesita actualización (sacar de Scope OUT). |
| 6 | 🟡 ALTO | **`capabilities` vacío en DB**: `capabilities: []` en la fila de muestra. La fallback chain `model.capabilities?.[0]?.example?.output` siempre resuelve `undefined`. En la práctica el sandbox siempre usará el último fallback `{ message: "Sandbox mode — no example output configured" }` en la mayoría de agentes hasta que `example_output` se configure. No es un bug bloqueante pero la UX del sandbox es degradada por defecto. | Documentar en SDD o en notas de deploy que `sandbox_enabled: true` requiere configurar `metadata.example_output` (o el campo correcto) para que sandbox retorne output real. |
| 7 | 🟡 ALTO | **Sandbox en invoke sin rate limit especificado**: el PROHIBIDO dice "Sandbox sin rate limit (anónimo o no)". Wave 1 describe la lógica sandbox pero NO especifica qué rate limiter usar. El rate limit global de invoke ya existe (`checkRateLimit(getInvokeLimit(), rlId)`), pero el SDD no confirma si ese es suficiente o si se necesita uno dedicado. | Aclarar en SDD que el rate limit global de invoke (`getInvokeLimit()`) cubre el sandbox shortcut (ya aplica antes del sandbox check). |
| 8 | 🟢 BAJO | **`NativeBody` schema es demasiado permisivo**: `z.record(z.unknown())` con refine `length > 0` acepta cualquier objeto no-vacío, incluyendo `{ input: 123 }` (input no-string). Con Zod union, `{ input: 123 }` falla LegacyBody (string required) y pasa NativeBody — se envía como body nativo al upstream. Puede confundir a callers que tenían un bug de tipo. | Mencionar este edge case en el SDD como comportamiento esperado o agregar nota al Builder. |
| 9 | 🟢 BAJO | **`logTrialCall` es `await` en trial/route.ts**: el SDD dice sandbox log es "fire-and-forget". La función actual `logTrialCall` se await-ea. El Builder necesita recordar usar `after()` o `void` para el sandbox log. | Agregar nota explícita en el SDD: "log sandbox vía `after()` o `void` (no await)". |

---

## Veredicto: ⛔ NECESITA CORRECCIÓN

**Bloqueantes (deben corregirse en el SDD antes de pasar al Builder):**

1. **Finding #3** — Agregar `metadata, capabilities` al SELECT de invoke/POST (Wave 1)
2. **Finding #4** — Reordenar flujo sandbox en trial/route.ts o modificar schema para body vacío con sandbox header
3. **Finding #2** — Corregir nombre de campo: `metadata.example_output` → `metadata.input_example` (o aclarar cuál es el campo canónico)

**Recomendados antes de Builder:**

4. **Finding #1** — Aclarar que `slug` se obtiene de `model.slug` dentro de `build402Instructions()`
5. **Finding #5** — Decidir si `output` sigue siendo `string` o el frontend entra en scope

Los findings #6-#9 son informativos — el Builder puede resolverlos en implementación.
