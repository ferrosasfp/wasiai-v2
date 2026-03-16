## Build Report — SDD #WAS-220

### Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 | ✅ PASS | — | Re-validación vs código real. insert-audit.md confirmado completo. Migración SQL ejecutada en dev via Supabase Management API. CHECK constraint expandido a `('x402','sandbox','api_key','free_trial','unknown')`. |
| Wave 1 | ✅ DONE | ✅ PASS | 3 archivos modificados: invoke/route.ts, sandbox/route.ts, compose/route.ts |
| Wave 2 | ✅ DONE | — | Query de verificación en dev: constraint confirmada con `pg_get_constraintdef`. 0 discrepancias. |

### Commit
- Hash: `6a75366a9`
- Message: `fix(WAS-220): audit y corrección de payment_type + agent_slug en agent_calls inserts`
- Files changed: 5

### Cambios implementados

#### `invoke/route.ts`
- Extendida firma de `logCall()` con parámetro opcional `paymentType?: string`
- Agregado `payment_type: paymentType ?? 'unknown'` al insert en `agent_calls`
- Route A (api_key): las 2 llamadas a `logCall()` pasan `'api_key'`
- Route B (x402): la llamada a `logCall()` pasa `'x402'`

#### `sandbox/invoke/[slug]/route.ts`
- Insert schema_violation: agregado `agent_slug: slug`
- Insert normal (paso 10): agregado `agent_slug: slug`
- `payment_type: 'sandbox'` ya estaba presente en ambos — no se modificó

#### `compose/route.ts`
- Insert schema_violation en `executeStep()`: agregados `payment_type: 'api_key'` y `agent_slug: agent.slug`
- Insert normal en `executeStep()`: agregados `payment_type: 'api_key'` y `agent_slug: agent.slug`

#### `supabase/migrations/063_expand_payment_type_check.sql`
- Migración creada y ejecutada en dev
- Resultado verificado: `CHECK ((payment_type = ANY (ARRAY['x402'::text, 'sandbox'::text, 'api_key'::text, 'free_trial'::text, 'unknown'::text])))`

### Discrepancias encontradas
- **insert-audit.md** ya estaba creado por el Spec Reviewer — contenía la información completa. No se requirió recrear.
- **Sandbox inserts**: el insert-audit indicaba que `payment_type: 'sandbox'` faltaba, pero el código real ya lo tenía ✅. Solo faltaba `agent_slug`. El audit fue conservado tal cual (es la observación del Spec Reviewer al momento de su análisis).

### Paths OUT OF SCOPE documentados
- `trial/route.ts` — sin payment_type ni agent_slug (deuda técnica)
- `mcp/route.ts` — sin payment_type ni agent_slug (deuda técnica)
- `introspect/route.ts` — no auditado en detalle (deuda técnica)

### Notas para QA/Auditor
- El `paymentType` en `logCall()` es opcional con default `'unknown'` — esto es safe: evita romper si alguien llama logCall sin el parámetro (backward compatible)
- La migración SQL fue aplicada directamente vía Supabase Management API (sin `supabase db push` porque no hay `config.toml` en el repo)
- Build: `npm run build` — 0 errores TypeScript, 0 warnings de compilación
- Branch: `task/220-agent-calls-insert-audit`
