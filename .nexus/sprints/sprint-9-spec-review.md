# Spec Review — Sprint 9

**Reviewer:** Spec Reviewer (subagent)  
**Fecha:** 2026-03-15  
**SDDs:** DEUDA-02, WAS-206, DEUDA-01, DEUDA-03, WAS-205

---

## DEUDA-02 — APIs sin manejo de errores

**Findings:**

| # | Tipo | Severidad | Detalle |
|---|------|-----------|---------|
| 1 | 0.1 Fix parcial | INFO | `discover/route.ts` ya tiene `if (error) return 500` (línea ~45). El try/catch exterior falta, pero la validación de error de Supabase ya existe allí. Las otras dos rutas NO tienen nada. |
| 2 | 0.3b Encoding | BLOQUEANTE | `agents/route.ts` (path de búsqueda, ~línea 70) expone `error.message` de Supabase en `{ error: searchError.message }`. El SDD cubre Wave 2 como "la query principal" pero no toca el branch de búsqueda RPC. La constraint **PROHIBIDO exponer error.message** queda violada en ese path. |
| 3 | 0.5 Ambigüedad | MEDIO | Wave 3 dice "mismo patrón que Wave 2" para `discover/route.ts` pero no especifica el try/catch wrapper alrededor del RPC (la query es `supabase.rpc(...)`, no un query builder). El Builder podría implementarlo incorrectamente. |
| 4 | Coherencia | INFO | No hay lista explícita de AC, pero los constraints son claros. CORS en error responses: ✅ mencionado. Rollback ejecutable: ✅. PROHIBIDO ≥ 2: ✅ (3 constraints). |

**Veredicto:** BLOQUEANTE — Finding #2: el SDD debe incluir Wave 2b que corrija el branch RPC de búsqueda en `agents/route.ts` (reemplazar `{ error: searchError.message }` por `{ error: 'internal_error', message: 'Service temporarily unavailable' }`).

---

## WAS-206 — buildExampleFromSchema inteligente + preview en formulario

**Findings:**

| # | Tipo | Severidad | Detalle |
|---|------|-----------|---------|
| 1 | 0.1 Fix no existe | INFO | Util centralizado no existe (`ls src/features/agents/utils/` → directorio no existe). Funciones locales duplicadas confirmadas en AgentTrialPlayground.tsx (línea 15) y SandboxClient.tsx (línea 24). Fix requerido, no hecho. ✅ |
| 2 | 0.3a Tipo faltante | BLOQUEANTE | Wave 2 llama `onChange('metadata', { ...(data.metadata as object ?? {}), input_example: ... })` pero `CreateModelDraft` NO tiene campo `metadata` (verificado en `model.schema.ts`). Esto produce error TypeScript en el build gate. El Builder no podrá pasar Wave 2. |
| 3 | 0.3a Conflicto de estado | BLOQUEANTE | Wave 2 declara `const [inputSchemaRaw, setInputSchemaRaw] = useState<string>('')` pero `Step3Technical.tsx` ya declara ese mismo estado en línea 22. Re-declarar produce error de compilación. El SDD debe omitir esa línea del snippet. |
| 4 | 0.3a JSON.parse sin try/catch | MEDIO | Wave 2 snippet: `buildExampleFromSchema(JSON.parse(val))` dentro del onChange del textarea — sin try/catch. Si el usuario escribe JSON inválido, lanzará excepción no capturada. Debe envolverse en try/catch. |
| 5 | 0.5 Ambigüedad | MEDIO | Wave 2 no especifica dónde exactamente insertar el bloque JSX de preview (qué componente/sección, referencia a línea o elemento circundante). El Builder necesita inferir la ubicación en un archivo de ~250 líneas. |
| 6 | 0.4 Dependencias | INFO | SDD no lista dependencia de `useRef` import en Step3Technical.tsx para `debounceRef`. Debe agregarse al import existente. |

**Veredicto:** BLOQUEANTE — Findings #2 y #3 son errores de compilación garantizados.

---

## DEUDA-01 — API expone example_input resuelto

**Findings:**

| # | Tipo | Severidad | Detalle |
|---|------|-----------|---------|
| 1 | 0.4 Dependencia | INFO | Depende de WAS-206 (buildExampleFromSchema). Declarado explícitamente en el SDD. ✅ |
| 2 | 0.1 Fix no existe | INFO | `metadata` no está en SELECT de `/agents/[slug]` (confirmado). `example_input` no se expone en ninguno de los 3 endpoints. ✅ Fix requerido. |
| 3 | 0.5 Gap de cobertura | MEDIO | Wave 3 no menciona el path `slim=true` de `agents/route.ts`. En slim mode el SELECT no incluye `capabilities` ni `input_schema`, entonces `resolveExampleInput` siempre devuelve `EXAMPLE_FALLBACK`. Si el cliente slim necesita `example_input`, el SDD debería documentar que slim mode queda excluido intencionalmente (o agregar el campo). |
| 4 | 0.5 Gap de cobertura | MEDIO | El path de búsqueda RPC (`q` param) en `agents/route.ts` tampoco agrega `example_input` al map de resultados. La RPC `search_agents` puede no devolver `metadata`/`capabilities` — no verificable sin schema de BD, pero el SDD no lo menciona. |
| 5 | 0.3b Tipo | INFO | `AgentLike.input_schema?: Record<string, unknown>` — Supabase puede retornarlo como tipo `Json` genérico. En la práctica funciona, pero puede generar warning de TypeScript. Bajo riesgo. |

**Veredicto:** APROBADO con observaciones — Findings #3 y #4 son gaps documentales, no bloqueantes para el Builder. Recomendar documentar exclusiones explícitamente.

---

## DEUDA-03 — Activar NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=true en prod

**Findings:**

| # | Tipo | Severidad | Detalle |
|---|------|-----------|---------|
| 1 | 0.2 Archivos | INFO | `.env.example` existe y ya tiene `NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=false`. Wave 2 puede actualizar correctamente. ✅ |
| 2 | 0.3a Shell bug | MEDIO | Wave 2 usa `echo "\n# ..."` — en bash, `echo` no interpreta `\n` por defecto (depende del sistema). El resultado literal sería `\n# Input schema...` pegado al contenido existente sin newline real. Debe usar `printf '\n# ...\n'` o `echo -e`. |
| 3 | 0.0 Wave 0 circular | INFO | Wave 0 hace curl a la API de producción para verificar WAS-206, pero la URL usada (`wasiai-agents.vercel.app`) puede no ser el dominio de prod correcto (`app.wasiai.io`). Verificar que el dominio del pre-flight coincida con prod real. |
| 4 | Coherencia | INFO | No hay AC explícitos. El SDD es operativo (activar una env var), el rollback es ejecutable vía CLI, PROHIBIDO tiene 2 constraints (solo production, solo después de WAS-206). ✅ |

**Veredicto:** APROBADO con observaciones — Finding #2 es un bug de shell que produce `.env.example` malformado pero no bloquea el objetivo principal (activar la env var en Vercel).

---

## WAS-205 — Zero-Friction Input en todas las superficies

**Findings:**

| # | Tipo | Severidad | Detalle |
|---|------|-----------|---------|
| 1 | 0.4 Dependencias | INFO | Depende de WAS-206 y DEUDA-01. Declarado. ✅ |
| 2 | 0.1 Estado actual | INFO | SandboxClient.tsx tiene `buildExampleFromSchema` local (línea 24) usada como `placeholder` — NO como valor de `inputText`. TryIt.tsx tiene `EXAMPLE_PAYLOADS` hardcodeado (línea 13). Ambos necesitan fix. ✅ |
| 3 | 0.5 Constraint violada por el propio SDD | BLOQUEANTE | El constraint dice **PROHIBIDO resetear el input si el usuario ya lo modificó manualmente**, pero el código de Wave 1 llama `setInputText(data.example_input)` en `fetchExampleInput` sin ningún check de "dirty state". Si el usuario ya escribió algo y cambia de agente, el fetch sobreescribirá su input. El SDD debe agregar un flag `isDirty` o comparar con el valor actual antes de sobrescribir. |
| 4 | 0.3a Incompatibilidad de estructura | MEDIO | SandboxClient.tsx no tiene función `handleSlugChange` — el cambio de slug está inline en el `onChange` del select (línea 240). Wave 1 asume que existe dicha función. El Builder debe crear esta función e reemplazar el inline, lo cual el SDD no describe explícitamente. |
| 5 | 0.3a async en handler | MEDIO | Wave 2 convierte `handleSlugChange` en `async function`. Si esta función es pasada como callback de evento o referenciada en un `useCallback` con types, el cambio de sync→async puede requerir ajustes de tipos. Verificar que en TryIt.tsx no haya conflictos. |
| 6 | 0.5 Placeholder sin reemplazo | INFO | SandboxClient Wave 1 elimina `buildExampleFromSchema` local pero actualmente se usa como `placeholder` en el textarea (línea 259). El SDD no especifica qué usar como placeholder después. Dejar vacío es aceptable pero debe ser explícito. |

**Veredicto:** BLOQUEANTE — Finding #3: la constraint más crítica del SDD (no sobreescribir input del usuario) no está implementada en el código de referencia. El Builder implementará lo que ve en el código — y violará la constraint.

---

## Veredicto Global

**BLOQUEANTE**

| SDD | Veredicto | Bloqueantes |
|-----|-----------|-------------|
| DEUDA-02 | BLOQUEANTE | Branch RPC de búsqueda expone `error.message` en `/agents/route.ts` |
| WAS-206 | BLOQUEANTE | `metadata` no existe en `CreateModelDraft`; re-declaración de `inputSchemaRaw` |
| DEUDA-01 | APROBADO | — (observaciones documentales) |
| DEUDA-03 | APROBADO | — (bug de shell menor en Wave 2) |
| WAS-205 | BLOQUEANTE | Constraint PROHIBIDO violada por el propio código de referencia (no dirty-check) |

**Bloqueantes a resolver antes de pasar al Builder:**

1. **DEUDA-02:** Agregar sub-wave que corrija `{ error: searchError.message }` en el branch RPC de búsqueda de `agents/route.ts`
2. **WAS-206 / Wave 2:** Resolver campo `metadata` — añadirlo a `CreateModelDraft` o usar campo alternativo existente; eliminar re-declaración de `inputSchemaRaw`; agregar try/catch alrededor de `JSON.parse(val)`
3. **WAS-205 / Wave 1-2:** Agregar lógica dirty-check antes de llamar `setInputText`/`setPayload` en `fetchExampleInput`; documentar qué hacer con el `placeholder` del textarea en SandboxClient
