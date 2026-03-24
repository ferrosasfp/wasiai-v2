# Logic Audit — Free Trial UX (Sandbox + A2A + Zero Duplicación)

> Auditor: Logic Auditor subagent  
> Fecha: 2026-03-23  
> Diff: /tmp/builder-diff.txt  
> Archivos: invoke/route.ts, trial/route.ts

---

## AC Coverage

| AC | Status | Evidencia |
|----|--------|-----------|
| AC-1: Eliminar Route C del invoke | ✅ PASS | Bloque `if (!paymentHeader && model.free_trial_enabled)` (~91 líneas) eliminado del diff. 402 normal se restaura. |
| AC-2: Trial acepta body nativo (A2A) | ⚠️ PARCIAL | Zod union `LegacyBody \| NativeBody` implementado. `upstreamBody` pasa body nativo sin wrapping. PERO: work-item dice "parsea JSON si upstream responde JSON" — el código mantiene `output` como string puro (no parsea). SDD Wave 2 step 4 lo contradice y dice "output siempre es STRING". Código sigue SDD. Discrepancia work-item vs SDD, no es bug del builder. |
| AC-3: Sandbox Mode en Trial | ✅ PASS | `isSandbox = req.headers.get('x-sandbox') === 'true'`, check `agent.sandbox_enabled`, retorna sin upstream, sin decremento. `{ sandbox: true }` en respuesta. Log via `after()`. |
| AC-4: Sandbox fallback sin example_output | ✅ PASS | `meta?.input_example ?? meta?.example_output ?? { message: 'Sandbox mode — no example output configured' }` implementado correctamente. |
| AC-5: Sandbox en Invoke | ✅ PASS | Sandbox shortcut antes del payment check. Retorna `{ result, meta: { sandbox: true, charged: 0 } }`. No llama upstream. Log via `after()`. |
| AC-6: Body schema actualizado | ✅ PASS | `BodySchema = z.union([LegacyBody, NativeBody])`. Sandbox skip body validation correctamente. |
| AC-7: No romper frontend | ✅ PASS | Invariante `{ output: string, latencyMs }` preservado. Sandbox path retorna `{ output, sandbox: true, latencyMs: 0 }` — `output` y `latencyMs` presentes. |
| AC-8: 402 response incluye trial info | ✅ PASS | `free_trial: { available: true, endpoint: "/api/v1/agents/{slug}/trial", limit: N }` en 402. Condicionado a `model.free_trial_enabled`. |

---

## Bugs encontrados

| # | Severidad | Detalle | Fix |
|---|-----------|---------|-----|
| 1 | 🔴 CRÍTICO | **Null dereference en `parsed!.data`** — En `trial/route.ts`, cuando `isSandbox = true` pero `agent.sandbox_enabled = false`, el código salta la validación Zod (`parsed` queda `null`) pero NO retorna early en el sandbox path (porque `sandbox_enabled` es false). Luego cae al flujo normal y llega a `const parsedData = parsed!.data as Record<string, unknown>` — crash con `TypeError: Cannot read properties of null`. | Cuando `isSandbox && !agent.sandbox_enabled`, leer el body y validar normalmente. O retornar 400 `{ error: 'sandbox_not_enabled' }`. Fix mínimo: mover la detección `isSandbox` DESPUÉS de parsear el body, o forzar parse cuando `isSandbox && !agent.sandbox_enabled`. |
| 2 | 🟡 MENOR | **`after()` en invoke sandbox usa `supabase` (user client)** — El log de sandbox en `invoke/route.ts` usa `supabase` (cliente anónimo si no hay auth). Si la tabla `agent_calls` tiene RLS que requiere autenticación, el insert silenciosamente falla. El trial sandbox en `trial/route.ts` usa `svc` (service client) correctamente. Inconsistencia entre los dos handlers. | Cambiar el `after()` en `invoke/route.ts` para usar `createServiceClient()` al igual que el trial handler. |
| 3 | 🟡 MENOR | **Zod `z.union` ordena LegacyBody primero** — Un body `{ input: "foo", otherKey: "bar" }` matchea LegacyBody (Zod strip por defecto) y `otherKey` se descarta silenciosamente. El caller A2A podría enviar un body con `input` como una de sus keys y recibir comportamiento legacy inesperado. | Documentar como comportamiento esperado, o usar `z.union([NativeBody, LegacyBody])` invirtiendo el orden (NativeBody es más permisivo y siempre ganará, pero LegacyBody ya no tendría efecto). Alternativa: usar discriminated union explícita. Impacto real: bajo, ya que el upstreamBody check `'input' in parsedData && typeof parsedData.input === 'string'` también garantiza el routing. |

---

## Constraint violations

| Constraint | Status | Notas |
|------------|--------|-------|
| PROHIBIDO: Dos paths de free trial | ✅ OK | Route C eliminado. Un solo path: `/trial`. |
| PROHIBIDO: Exponer `endpoint_url` en respuesta | ✅ OK | No se expone en ningún path nuevo. |
| PROHIBIDO: Sandbox sin rate limit | ✅ OK | Rate limit se aplica antes del sandbox check en ambos endpoints. |
| PROHIBIDO: Romper `AgentTrialPlayground` | ✅ OK | Invariante `{ output: string, latencyMs }` preservado. |
| OBLIGATORIO: Usar RPC `use_trial` | ✅ OK | Usado en path autenticado de trial. Sandbox lo bypasea correctamente. |
| OBLIGATORIO: Body nativo pasa directo | ✅ OK | `JSON.stringify(parsedData)` sin wrapping. |
| OBLIGATORIO: `{ input: string }` legacy funciona | ✅ OK | LegacyBody en union, backward compat. |
| OBLIGATORIO: Sandbox NUNCA llama upstream | ✅ OK | Ambos handlers retornan antes del fetch. |
| OBLIGATORIO: Sandbox NUNCA decrementa counter | ✅ OK | `use_trial` RPC no se llama en sandbox path. |

---

## Veredicto: 🔴 BLOQUEANTE

**Bug #1 es un crash garantizado** en producción cuando un cliente envía `X-Sandbox: true` a un agente con `sandbox_enabled = false`. La variable `parsed` es `null` por diseño (skip de validación) y el `!` non-null assertion explota. Requiere fix antes de merge.

Bug #2 y #3 son menores y no bloquean el flujo principal, pero #2 debería corregirse en la misma wave.

### Fix requerido para Bug #1

```typescript
// En trial/route.ts, reemplazar:
let parsed: ReturnType<typeof BodySchema.safeParse> | null = null
if (!isSandbox) {
  parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
}

// Con:
let parsed: ReturnType<typeof BodySchema.safeParse> | null = null
if (!isSandbox) {
  parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
}
// NOTE: si isSandbox pero sandbox_enabled=false, 'parsed' es null aquí.
// El sandbox guard check de abajo maneja este caso correctamente si se agrega:

// AC-3/AC-4: Sandbox path
if (isSandbox) {
  if (!agent.sandbox_enabled) {
    // No sandbox on this agent — validate body normally and fall through
    parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  } else {
    // ... sandbox handler existente ...
  }
}
```
