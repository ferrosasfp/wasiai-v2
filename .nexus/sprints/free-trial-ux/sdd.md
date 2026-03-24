# SDD: Free Trial — Sandbox Mode + A2A + Zero Duplicación

> SPEC_APPROVED: no
> Fecha: 2026-03-23
> Tipo: improvement
> SDD_MODE: full

---

## 1. Resumen

Eliminar la duplicación de lógica de free trial entre `/models/{slug}/invoke` (Route C) y `/agents/{slug}/trial`. Un solo path: `/trial`. Adaptarlo para A2A (body nativo). Agregar sandbox mode (respuesta mock sin upstream).

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **Tipo** | improvement |
| **Objetivo** | Zero duplicación en free trial + sandbox + A2A |
| **Scope IN** | Eliminar Route C, adaptar `/trial`, sandbox en trial e invoke |
| **Scope OUT** | UI, badge, pago, CAPTCHA, migraciones DB |

### Acceptance Criteria: AC-1 a AC-8 (ver work-item.md)

## 3. Context Map

### Archivos a modificar
| Archivo | Cambio | Líneas aprox |
|---------|--------|-------------|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Eliminar Route C (~50 líneas), agregar sandbox shortcut (~20 líneas), agregar `free_trial` info en 402 | -30 neto |
| `src/app/api/v1/agents/[slug]/trial/route.ts` | Aceptar body nativo (Zod union), sandbox mode, header `X-Sandbox` | +40 |

### Archivos que NO se tocan
- `AgentTrialPlayground.tsx` — no changes
- `ModelCard.tsx` — no changes
- `payment-type.ts` — `'sandbox'` ya existe

## 4. Constraint Directives

### OBLIGATORIO
- Usar RPC `use_trial` para todo tracking de trial (ya existe, ya es atómico)
- Body nativo pasa directo al upstream sin wrapping
- `{ input: string }` legacy sigue funcionando (backward compat)
- Sandbox NUNCA llama al upstream
- Sandbox NUNCA decrementa trial counter

### PROHIBIDO
- Dos paths de free trial (duplicación)
- Exponer `endpoint_url` en cualquier respuesta (HAL-028)
- Sandbox sin rate limit (anónimo o no)
- Romper `AgentTrialPlayground`

## 5. Waves

### Wave 0 — Pre-flight
El Spec Reviewer y el Builder verifican:
- [ ] `sandbox_enabled` existe en tabla `agents` (`SELECT sandbox_enabled FROM agents LIMIT 1`)
- [ ] `'sandbox'` es valor válido en `assertPaymentType()`
- [ ] RPC `use_trial` existe y acepta `(p_user_id, p_agent_id, p_limit)`
- [ ] `example_output` o `metadata->example_output` existe como campo accesible
- [ ] Route C existe en invoke/route.ts (para confirmar qué eliminar)

**Build gate:** todos los checks pasan

### Wave 1 — Eliminar Route C + enriquecer 402 (AC-1, AC-8)

**Cambios en `invoke/route.ts`:**
1. Eliminar el bloque `if (!paymentHeader && model.free_trial_enabled) { ... }` completo (~50 líneas)
2. En `build402Instructions()`, si `model.free_trial_enabled`:
   - Agregar `free_trial: { available: true, endpoint: "/api/v1/agents/${slug}/trial", limit: model.free_trial_limit }` al JSON response
3. Eliminar el import de `createClient` si ya no se usa (era para JWT auth en Route C)
4. Quitar `free_trial_enabled, free_trial_limit, sandbox_enabled` del select si ya no se usan... PERO se necesitan para AC-5 (sandbox) y AC-8 (402 info), así que mantener en el select.

**Agregar `metadata, capabilities` al SELECT del model:**
5. En el `supabase.from('agents').select(...)`, agregar `metadata, capabilities` para que el sandbox shortcut tenga acceso a example output.

**Sandbox shortcut en invoke (AC-5):**
6. ANTES del check de payment (después del rate limit global que ya cubre sandbox), si `request.headers.get('x-sandbox') === 'true'` Y `model.sandbox_enabled`:
   - Buscar example output: `model.metadata?.input_example ?? model.metadata?.example_output ?? null`
   - Si no hay → fallback `{ message: "Sandbox mode — no example output configured" }`
   - Retornar `{ result: exampleOutput, meta: { model: slug, sandbox: true, charged: 0 } }` con status 200
   - Log via `after()` (fire-and-forget, no await) en `agent_calls` con `payment_type: 'sandbox'`
   - `slug` se obtiene de `model.slug as string` — ya disponible en scope
   - NO llamar upstream, NO checkear auth, NO checkear budget
   - Rate limit: ya cubierto por `checkRateLimit(getInvokeLimit(), rlId)` que ejecuta ANTES

**Build gate:** `npx tsc --noEmit` pasa, invoke sin sandbox/trial devuelve 402 normal

### Wave 2 — Adaptar `/trial` para A2A + Sandbox (AC-2, AC-3, AC-4, AC-6, AC-7)

**Cambios en `trial/route.ts`:**

1. **Reordenar flujo: sandbox check ANTES de Zod validation.**
   Detectar sandbox PRIMERO: `const isSandbox = req.headers.get('x-sandbox') === 'true'`
   Si `isSandbox` → saltar validación de body, ir directo al sandbox handler (después de buscar agente).

2. **Zod schema** — cambiar de:
   ```ts
   const BodySchema = z.object({ input: z.string().min(1).max(2000) })
   ```
   A:
   ```ts
   const LegacyBody = z.object({ input: z.string().min(1).max(2000) })
   const NativeBody = z.record(z.unknown()).refine(obj => Object.keys(obj).length > 0, 'Body must not be empty')
   const BodySchema = z.union([LegacyBody, NativeBody])
   ```
   NOTA: la validación Zod solo se ejecuta cuando NO es sandbox.

3. **Sandbox path** — después de buscar el agente, antes del trial check:
   ```
   if (isSandbox && agent.sandbox_enabled):
     exampleOutput = agent.metadata?.input_example ?? agent.metadata?.example_output ?? fallback
     log agent_calls via after() con payment_type: 'sandbox'
     return { output: exampleOutput, sandbox: true, latencyMs: 0 }
   ```
   Detectar sandbox: `req.headers.get('x-sandbox') === 'true'` O `parsed.data.sandbox === true`

3. **Body nativo** — cambiar cómo se pasa el body al upstream:
   ```
   if parsed.data tiene 'input' como string → legacy: JSON.stringify({ input })
   else → body nativo: JSON.stringify(parsed.data) (sin sandbox key)
   ```

4. **Response format** — el upstream puede retornar JSON o texto. Para mantener backward compat con `AgentTrialPlayground` (espera `output: string`):
   ```
   output siempre es STRING:
   - Si upstream retorna JSON → output = raw text (no parsear, el string ES el JSON serializado)
   - El frontend ya hace CopyableOutput con string
   ```
   Siempre retornar `{ output: string, latencyMs }` — invariante preservado

**Build gate:** `npx tsc --noEmit` + `eslint --max-warnings 0` pasan

## 6. Rollback

1. `git revert <commit-wave-1>` — restaura Route C, quita sandbox del invoke
2. `git revert <commit-wave-2>` — restaura trial endpoint original
3. No hay migraciones DB que revertir

## 7. Testing Notes

### Manual tests post-deploy
```bash
# AC-1: invoke sin pago devuelve 402 con trial info
curl -s -X POST app.wasiai.io/api/v1/models/blexsignal-scanner/invoke \
  -H "Content-Type: application/json" \
  -d '{"pairs":["BTC/USDT"]}' | jq '.free_trial'

# AC-2: trial con body nativo (A2A)
curl -s -X POST app.wasiai.io/api/v1/agents/blexsignal-scanner/trial \
  -H "Content-Type: application/json" \
  -d '{"pairs":["BTC/USDT"],"timeframes":["1d"]}'

# AC-3: sandbox via header
curl -s -X POST app.wasiai.io/api/v1/agents/blexsignal-scanner/trial \
  -H "X-Sandbox: true" | jq '.sandbox'

# AC-5: sandbox en invoke
curl -s -X POST app.wasiai.io/api/v1/models/blexsignal-scanner/invoke \
  -H "X-Sandbox: true" | jq '.meta.sandbox'
```
