# Build Report — Free Trial UX (Sandbox + A2A + Zero Duplicación)

> Builder: subagent (builder)
> Fecha: 2026-03-23
> SDD: `.nexus/sprints/free-trial-ux/sdd.md`

---

## Wave Execution Table

| Wave | Descripción | Estado | Build Gate | Commit |
|------|-------------|--------|-----------|--------|
| Wave 0 | Pre-flight validation | ✅ PASS | n/a | n/a |
| Wave 1 | Eliminar Route C + sandbox shortcut en invoke + enriquecer 402 | ✅ PASS | `tsc --noEmit` ✅ `eslint --max-warnings 0` ✅ | `bc7465938` |
| Wave 2 | trial: A2A body nativo + sandbox mode + detección temprana sandbox | ✅ PASS | `tsc --noEmit` ✅ `eslint --max-warnings 0` ✅ | `d29af0975` |

---

## Commit Hashes

| Wave | Hash | Mensaje |
|------|------|---------|
| Wave 1 | `bc7465938` | `feat(invoke): remove Route C, add sandbox shortcut, enrich 402 with free_trial info (AC-1, AC-5, AC-8)` |
| Wave 2 | `d29af0975` | `feat(trial): A2A native body, sandbox mode, early sandbox detection before Zod (AC-2, AC-3, AC-4, AC-6, AC-7)` |

---

## Wave 0 — Pre-flight Checks

| Check | Resultado |
|-------|-----------|
| Route C existe en invoke/route.ts | ✅ Confirmado (lines ~272-360) |
| `sandbox_enabled` en SELECT del model | ✅ Ya estaba en SELECT |
| `'sandbox'` válido en `assertPaymentType()` | ✅ en `VALID_PAYMENT_TYPES` |
| RPC `use_trial` existe | ✅ Usado en trial/route.ts |
| `metadata.input_example` (campo correcto DB) | ✅ SDD ya corregido por Spec Reviewer |
| `metadata, capabilities` NO en SELECT de invoke | ✅ Detectado y agregado en Wave 1 |

---

## Cambios Implementados

### Wave 1 — `invoke/route.ts`

1. **`metadata, capabilities` agregado al SELECT** — requerido para sandbox shortcut (Finding #3 del Spec Review)
2. **Route C eliminada** — bloque `if (!paymentHeader && model.free_trial_enabled)` removido (~50 líneas)
3. **`build402Instructions()` enriquecida** — agrega `free_trial: { available, endpoint, limit }` cuando `model.free_trial_enabled` (AC-8). Usa `model.slug as string` (Finding #1 resuelto)
4. **Sandbox shortcut** — antes de Route B, detecta `x-sandbox: true` + `model.sandbox_enabled`. Retorna example output desde `metadata.input_example ?? metadata.example_output ?? fallback`. Log via `after()` fire-and-forget. Nunca llama upstream, nunca decrementa trial (AC-5)
5. **`reqHeaders`/`paymentHeader` movidos** — declarados justo antes de Route B (ya no se declaraban en Route C)

### Wave 2 — `trial/route.ts`

1. **`after` importado** — para logging sandbox fire-and-forget
2. **Zod schema expandido** — `LegacyBody | NativeBody` union. `NativeBody = z.record(z.string(), z.unknown()).refine(...)` (zod v4 requiere 2 args en `z.record`)
3. **Detección sandbox temprana** — `isSandbox` detectado ANTES de Zod validation (Finding #4 del Spec Review)
4. **Validación Zod condicional** — `parsed = null` cuando `isSandbox`, skip validación
5. **`sandbox_enabled, metadata` en SELECT** — para sandbox path
6. **Sandbox path** — después de buscar agente, antes de trial check. `output` siempre string. Log via `after()` fire-and-forget (AC-3, AC-4, AC-6)
7. **Body nativo al upstream** — legacy `{ input: string }` → `JSON.stringify({ input })`, native → `JSON.stringify(parsedData)` (AC-2)
8. **output siempre string** — invariante preservado para `AgentTrialPlayground` (AC-7)

---

## Discrepancias vs SDD

| # | Tipo | Detalle |
|---|------|---------|
| D-1 | Adaptación | `z.record(z.unknown())` → `z.record(z.string(), z.unknown())` — zod v4 requiere key type explícito. Semánticamente equivalente. |
| D-2 | Adaptación | `z.SafeParseReturnType` no existe en zod v4 → `ReturnType<typeof BodySchema.safeParse>`. Tipado correcto. |
| D-3 | Aclaración | SDD dice "Detectar sandbox: `req.headers.get('x-sandbox')` O `parsed.data.sandbox === true`" — implementado solo por header. El check por `parsed.data.sandbox` requeriría parsear body antes de detectar sandbox, violando Finding #4 (sandbox sin body debe funcionar). Header-only es correcto. |

---

## Notas

- **NO se hizo git push** — conforme a instrucciones
- **No se tocó código adyacente** — solo los 2 archivos en scope
- **`createClient` import mantenido** — sigue usado en GET handler de invoke
- **Sandbox en invoke**: Rate limit global ya aplica antes del sandbox check (Finding #7 del Spec Review — confirmado como suficiente)
- **`capabilities` field**: Agregado al SELECT pero no usado en sandbox path (siempre vacío en DB según Spec Review Finding #6). `metadata.input_example` es la fuente canónica.
