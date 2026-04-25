# Auto-Blindaje — WAS-V2-1: External Facilitator Opt-in

**Repo:** wasiai-v2 | **HU:** WAS-V2-1 | **Fechas:** F2 grounding 2026-04-24 → F4 DONE 2026-04-24 | **Pipeline:** QUALITY completo (F0..F4)

---

## AB-WAS-V2-1-1: Pipeline NexusAgil completo desde F0

**Contexto:** WAS-V2-1 + WKH-55 (wasiai-a2a paralelo) cierran la integración cross-chain Kite↔Avalanche con disciplina de proceso post-AB-WFAC-52-1 (auto-blindaje previo que formalizó la convención single-file SDD).

**Lección extraída:**
- Pipeline completo (F0 → F1 → GATE → F2 → GATE → F2.5 → F3 → AR → GATE → CR → GATE → F4 → DONE) **no es lujo**, es baseline.
- WAS-V2-1 ejecutó las 8 fases obligatorias, gates humanos (R-2 resuelto externamente) y 5 sub-agentes (analyst, architect, dev, adversary, qa).
- Convención single-file SDD respetada (no split en work-item.md + sdd.md separados; F2.5 story-file vive in-place).
- Anti-hallucination contract verificado en F2.5 grounding (4 callsites: invoke:12, invoke:143, introspect:17, introspect:360 coinciden bit-exact con SDD).
- F4 validation con arquivo:línea para cada AC (no "PASS" genérico).

**Aplicabilidad:**
- Futuras integraciones de facilitador externo (ej. WKH-56 para Kite settlements via wasiai-a2a) deben ejecutar pipeline completo sin saltearse fases.
- Cambios en crítico path de payment (settlement, withdrawal, balance) **no se implementan fuera de QUALITY mode**.
- Gates humanos existen por razón: R-2 requirió coordinación cross-team (wasiai-v2 + Railway facilitator). No fue detectado en F1 (scope del work-item), se escaló, se resolvió, F2 prosiguió.

**Métrica exitosa:**
- 12/12 ACs PASS (100%), 16/16 CDs satisfied (100%), 0 AC bloqueant en F4.
- 2 commits solo (f4366c2ea + b1670ab40), branch clean, historia lineal, cherry-pick amigable.

---

## AB-WAS-V2-1-2: AC-6 propagation pattern — CRÍTICA

**Contexto:** AR detectó BLQ-MED-1 en pre-merge de f4366c2ea. Route `/invoke` retornaba HTTP 200 cuando settlement fallaba en fase `/settle` (después de `/verify` exitoso).

**Bug exacto:**
```ts
// BEFORE (f4366c2ea inicial)
const settlement = await settlePaymentX402(payload, required, ctx)
if (!settlement.verified) {
  return NextResponse.json({ error: settlement.error }, { status: 402 })
}
// Si verified:true pero settled:false → route respondía 200 (WRONG)
return NextResponse.json({ result: true, meta: { tx_hash: settlement.transactionHash } })
```

**Fix (b1670ab40):**
```ts
const settlement = await settlePaymentX402(payload, required, ctx)
if (!settlement.verified) {
  return NextResponse.json({ error: settlement.error }, { status: 402 })
}
if (!settlement.settled) {  // ← ADD THIS GUARD
  return NextResponse.json({ error: settlement.error }, { status: 502 })  // settled failed after verify ok
}
return NextResponse.json({ result: true, meta: { tx_hash: settlement.transactionHash } })
```

**Lección (replicable a otros multi-state results):**

Cuando una función retorna un shape como:
```ts
{
  verified: boolean,    // Phase 1: signature check
  settled: boolean,     // Phase 2: on-chain tx
  transactionHash?: string,
  error?: string
}
```

El consumidor DEBE crear guards explícitos para CADA estado, NO asumir correlación:
- `verified:false, settled:false` → AC-4 path (verify failed) → 402 en route, error en body
- `verified:true, settled:false` → AC-5 path (verify ok, settle failed) → 502 en route, error en body
- `verified:true, settled:true` → success (200 + txHash)
- `verified:false, settled:true` → imposible, pero if codificado defensivamente (verificar en tests)

**Pattern checklist (para AR en futuras HUs):**
```
If función retorna `{state1: bool, state2: bool}`:
  ☐ Existe test combinatorial (true-true, true-false, false-true, false-false)? 
  ☐ Consumidor guardó state1=false ANTES de business action? 
  ☐ Consumidor guardó state2=false ANTES de business action?
  ☐ Documentación clarifica implicación de cada combo?
```

**Métrica:**
- AR detectó en W0 de F3 (pre-merge), fix fue ~10 líneas + 2 tests → cierre rápido.
- Sin este pattern, código pasaría a prod → production bug reportado por clientes.

---

## AB-WAS-V2-1-3: Append-only refactor strategy

**Contexto:** WAS-V2-1 requería extender `settlePaymentDirectly(payload, required)` sin modificar su cuerpo. Solución: wrapper `settlePaymentX402(payload, required, ctx)` en el mismo archivo.

**Estrategia elegida:**
```ts
// src/lib/contracts/usdcSettler.ts

// LÍNEAS 1-265: ORIGINAL, INTACTAS
export async function settlePaymentDirectly(
  payload: X402EVMPayload,
  required: string,
): Promise<SettlementResult> {
  // ... actual settlement code
}

// LÍNEA 270+: NUEVO APPEND (no touch líneas 1-265)
export interface SettlePaymentX402Ctx { ... }

export async function settlePaymentX402(
  payload: X402EVMPayload,
  required: string,
  ctx: SettlePaymentX402Ctx,
): Promise<SettlementResult> {
  const url = getFacilitatorUrl()
  if (url === null) {
    // Branch 1: flag unset → delegar a settler interno
    return settlePaymentDirectly(payload, required)
  }
  // Branch 2: flag set → usar facilitator externo
  const envelope = buildX402V2Envelope(payload, ctx)
  // ... HTTP calls ...
}
```

**Ventajas del append-only:**
1. **Rollback instantáneo:** Unset `X402_FACILITATOR_URL` → wrapper automáticamente cae a `settlePaymentDirectly()`, cero código nuevo ejecutado.
2. **Versionamiento transparente:** Legacy code (`settlePaymentDirectly`) se mantiene bit-exact. Auditors, SCANs, static analyzers, PRs ven que el algoritmo crítico NO cambió.
3. **Testabilidad bifurcada:** Tests del wrapper aislan la lógica de dispatch (flag-driven). Tests de `settlePaymentDirectly` permanecen heredados, garantizando no-regresión del path interno.
4. **History limpio:** `git blame settlePaymentDirectly.ts:80-115` siempre apunta al commit original, nunca a WAS-V2-1. Útil para forensics post-incident ("¿cuándo se cambió ese algoritmo?").

**Alternativa rechazada (split):**
```ts
// ❌ BAD: duplicación
export async function settlePaymentDirectly_legacy(...) { ... }
export async function settlePaymentDirectly_v2(...) { ... }
// Ahora hay 2 versiones de settler, deben sincronizarse en fixes (HAL-019 timing). Pesadilla.
```

**Aplicabilidad:**
- Siempre que una feature gate requiera legacy path + new path, prefer **append-only en el mismo módulo** sobre split (dos archivos = dos versiones diferentes del algoritmo = sincronización manual de fixes).
- Criterio: ¿El algoritmo principal cambió? NO (append-only). ¿El algoritmo cambió? SÍ (redesign en nueva HU, no append-only).

**Verificación en F4:**
- CD-3 formaliza: `git diff src/lib/contracts/usdcSettler.ts:1-265` debe ser vacío.
- F4 valida con diff exacto; no hubo delta.

---

## AB-WAS-V2-1-4: Same-wallet cross-chain operator pattern

**Contexto:** Operación de settlement x402 requiere una wallet que firme EIP-3009 `transferWithAuthorization` en Avalanche Fuji. wasiai-facilitator (Railway) maneja `/verify` y `/settle`. ¿De cuál wallet son las firmas?

**Decisión (R-2 resuelto):**
- Opción A (elegida): Operador único `0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba` en ambos servicios.
  - wasiai-v2: `OPERATOR_PRIVATE_KEY` env var.
  - wasiai-facilitator: `OPERATOR_PRIVATE_KEY` env var (Railway).
  - Resultado: misma wallet firma en ambos repos.

**Ventajas:**
1. **Ops surface:** Una sola wallet a monitorear, revocar, rotar. Dashboard del operador unificado.
2. **EIP-3009 simplificación:** El `from` en `authorization` es siempre el mismo. Clientes que cachean "quién es el operador actual" no necesitan refetch.
3. **Auditoría:** En on-chain analytics, txs de ambos servicios aparecen bajo una identidad — easier pattern matching.

**Trade-off crítico:**
- **Compromise de una wallet = todos los servicios afectados.**
  - Si la PK se expone → attacker puede operar settlements en nombre de v2 + facilitator + a2a.
  - Mitigation hoy (WAS-V2-1): Sentry alerts para grandes settlements. Runbook: revoke PK en Railway + wasiai-v2, redeploy.
  - Mitigation futuro (WKH-SEC-02): implementar Kite Passport, cada servicio obtiene firma delegada ephemeral sin almacenar PK.

**Métrica:**
- Railway facilitator `OPERATOR_PRIVATE_KEY` alineado a wasiai-v2 en 2026-04-24.
- On-chain balances verificados post-rollout: `0.494 AVAX + 20.01 USDC` en Fuji, `9.99 PYUSD` en Kite.
- Cero desviaciones en settlement tx history.

**Aplicabilidad:**
- Same-operator pattern (single key across multiple chains) es válido para **MVP/early-stage**, but not for scale-up.
- Cuando llegues a 3+ servicios usando la misma key, reconsidera: (a) por-service keys + coordinador que delega sigs, o (b) accountAbstraction (ERC-4337) con bundler unificado.

---

## AB-WAS-V2-1-5: Strict envelope construction (no spread trap)

**Contexto:** wasiai-facilitator (`verify` + `settle` routes) usa Zod `.strict()` en sus schemas:

```ts
// wasiai-facilitator/src/core/schemas.ts
export const VerifyRequestSchema = z.object({
  x402Version: z.literal(2),
  resource: z.object({ url: z.string(), ... }),
  accepted: z.object({ ... }),
  payload: z.object({ ... }),
}).strict()  // ← NO extra fields allowed
```

**El trap:**
```ts
// ❌ BAD: spread can inject extra keys
const ctx = { agentSlug: 'echo', facilitatorUrl: '...' }
const envelope = {
  ...ctx,  // oops, agentSlug + facilitatorUrl added to envelope
  x402Version: 2,
  resource: { ... },
  // ...
}
// Zod rejects: "agentSlug" is not allowed.
// Error: HTTP 400 without meaningful message (shape rejection, not code rejection).
```

**El fix:**
```ts
// ✓ GOOD: explicit keys only
const envelope = {
  x402Version: 2,
  resource: {
    url: ctx.resourceUrl,
    description: `WasiAI agent: ${ctx.agentSlug}`,
  },
  accepted: { ... },
  payload: ctx.payload,
}
// No spread. Shape matches schema exactly.
```

**Lección extraída:**
- Zod `.strict()` + spread = **silent failures** (HTTP 400, no error details).
- Code-level type system (TypeScript) **does not detect** shape violations — only runtime Zod does.

**Pattern (para AR):**
```
If consumidor de external API con `.strict()` schema:
  ☐ Grep for "...spread" en código que construye envelope/request?
  ☐ Prohibir via CD: "object literal con explicit keys, no spread".
  ☐ Linter rule: forbid `...` in function X context.
  ☐ Test: validate exact key order matches schema (CD-NEW-SDD-6).
```

**Aplicabilidad:**
- Same pattern en ABs previos (WFAC-20 W1 facilitator receiver side, HAS-053 envelope validation).
- **Siempre que integres código C que usa Zod `.strict()` o JSON Schema `"additionalProperties": false`:**
  1. Estudiar schema exacto.
  2. Crear test que valida key order (no just type check).
  3. Prohibir spread en codebase (linter o CD).
  4. AR debe hacer `grep "\.\.\.ctx\|\.\.\.payload"` en code review.

**Métrica (F4):**
- Test "CD-NEW-SDD-6: produces envelope with explicit keys in schema order" valida `Object.keys(env) === ['x402Version', 'resource', 'accepted', 'payload']`.
- Zero HTTP 400 shape rejections en canary + prod (post-rollout).

---

## Tabla consolidada (reference)

| ID | Contexto | Patrón | Checklist (AR) | Aplicable a |
|----|----------|--------|----------------|------------|
| **AB-WAS-V2-1-1** | QUALITY pipeline complete | All 8 phases mandatory | Agentes sub contratados, gates verificados, F4 con archivo:línea | Payment integraciones, settler extensiones |
| **AB-WAS-V2-1-2** | Multi-state result handling | Guards explícitos para c/ estado | Combinatorial tests (2^n)? business action guards? | Any `{state1, state2, ...}` return |
| **AB-WAS-V2-1-3** | Append-only refactors | Flag-driven dispatch, legacy untouched | `git diff src/file.ts:1-OLD_END` empty? rollback = env unset? | Feature gates, dual-path algorithms |
| **AB-WAS-V2-1-4** | Same-wallet cross-chain | Single operator, compromise = all services affected | Ops surface documented? PK rotation plan? | Cross-chain signing, EIP-3009 |
| **AB-WAS-V2-1-5** | Strict envelope construction | No spread, explicit keys | `.strict()` upstream? key order test? linter rule? | Zod consumers, JSON schema `.additionalProperties:false` |

---

## Interdependencias (otros auto-blindajes)

- **AB-WFAC-52-1:** "Convención single-file SDD" — WAS-V2-1 heredó esta convención. F2.5 story-file vive in-place, no split. Facilitó streamlining, menos archivos a sincronizar.
- **AB-WFAC-20 W1:** "Facilitator receiver strict schema" — WAS-V2-1 consumidor de ese mismo patrón. Zod `.strict()` en wasiai-facilitator, WAS-V2-1 respeta explícit keys.
- **AB-WAS-51 / WAS-53 (Ownership Guard):** "CD-AB-3 hardcode avoidance" — WAS-V2-1 routes heredan constantes (`USDC_ADDR`, `CONTRACT_ADDRESS`, `CHAIN`). No replicación de chain IDs.

---

## Recomendaciones para futuras HUs

1. **Multi-state pattern (AB-WAS-V2-1-2):** Codificar en EARS AC una tabla explícita de estados esperados (ej. "IF verified=false THEN settled=false MUST also be true"). F4 QA debe validar producto cartesiano.

2. **Append-only CD (AB-WAS-V2-1-3):** Formalizar en repo-level CLAUDE.md: "Feature gates en crítico path MUST use append-only strategy. CD template: `git diff src/file.ts:1-LEGACY_END` shall be empty".

3. **Operator keying (AB-WAS-V2-1-4):** Si planning multi-service settlement, crear WKH-SEC-02-like épica antes de merge. Runway: ~3 meses hasta Kite Passport, por ahora mitigation = runbook.

4. **Strict schema testing (AB-WAS-V2-1-5):** Cuando consumidor de external API con Zod/.strict(), crear linter rule o pre-commit hook que forbids spread en el módulo (ej. `eslint-plugin-no-rest-spread-in-zod-context`).

---

## Autores / Auditoría

- **F0-F2:** nexus-architect (SDD 1667 líneas, grounding wasiai-v2 + wasiai-facilitator)
- **F3:** nexus-dev (implementation, 5 waves, 36 tests)
- **AR/CR:** nexus-adversary (1 BLQ-MED + 13 MNRs, fix-pack b1670ab40)
- **F4:** nexus-qa (validation, 12/12 ACs, 16/16 CDs, 418/418 tests)
- **DONE:** nexus-docs (consolidación auto-blindaje, report, índice)

**Veredicto:** Auto-blindaje robusto (5 lecciones críticas), replicable a futuras HUs, prioridad = AB-WAS-V2-1-2 (patrón multi-state), AB-WAS-V2-1-3 (append-only = rollback seguro).
