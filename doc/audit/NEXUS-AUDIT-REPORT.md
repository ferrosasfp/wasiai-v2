# WasiAI v2.1 — Consolidated Security Audit Report (Post Dual Registration)

**Fecha:** 2026-03-05
**Metodologias:** NexusAudit v2.0 (Smart Contracts) + NexusGuard v1.0 (Web App)
**Auditor:** NexusAudit AI + NexusGuard AI
**Alcance:** Cambios post-v2.0 — Dual Registration (WAS-160), Sync Price (WAS-161), Transparency Dashboard (WAS-162)
**Baseline:** `security-audit-v2-consolidated.md` (26 findings, 22 fixed)

---

## Executive Summary

| Severity   | NexusAudit (On-Chain) | NexusGuard (Off-Chain) | Total |
|------------|----------------------|------------------------|-------|
| CRITICAL   | 0                    | 1                      | 1     |
| HIGH       | 0                    | 0                      | 0     |
| MEDIUM     | 2                    | 4                      | 6     |
| LOW        | 2                    | 3                      | 5     |
| INFO       | 2                    | 2                      | 4     |
| **TOTAL**  | **6**                | **10**                 | **16**|

**Risk Rating: MEDIUM** (1 finding CRITICAL en web app requiere atencion inmediata)

### Baseline Comparison

| Metrica | v2.0 Audit | v2.1 Audit | Delta |
|---------|-----------|-----------|-------|
| Total findings | 26 | 16 | -10 (nuevo scope) |
| CRITICAL | 0 | 1 | +1 (NEW) |
| HIGH (unfixed) | 0 | 0 | = |
| Regressions | - | 0 | 0 regressions |

Todos los 22 fixes del audit v2.0 siguen vigentes. No se detectaron regresiones.

---

## Scope (Delta vs v2.0)

### On-Chain (NexusAudit)
- `contracts/src/WasiAIMarketplace.sol` — 758 lineas (+65 vs v2.0)
  - NEW: `selfRegisterAgent()` (linea 229-247)
  - NEW: `withdrawKey()` (linea 550-560)
  - Modified: flow documentation comments (283-305)

### Off-Chain (NexusGuard)
- NEW: `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts` (115 lineas)
- NEW: `src/app/api/transparency/stats/route.ts` (33 lineas)
- NEW: `src/app/[locale]/publish/RegistrationChoiceModal.tsx` (208 lineas)
- NEW: `src/features/agents/components/UpgradeOnChainModal.tsx` (245 lineas)
- NEW: `src/features/agents/components/UpgradeOnChainButton.tsx` (56 lineas)
- NEW: `src/lib/contracts/config.ts` (9 lineas)
- NEW: `supabase/migrations/039_dual_registration.sql` (48 lineas)
- Modified: `src/app/api/v1/agents/register/route.ts` (WAS-160b dual path)
- Modified: `src/app/api/v1/agents/discover/route.ts` (discover_agents_v2 RPC)
- Modified: `src/lib/contracts/WasiAIMarketplace.ts` (selfRegisterAgent ABI)
- Modified: `src/lib/contracts/marketplaceClient.ts` (updateAgentOnChain)

---

## PARTE 1 — NexusGuard Findings (Off-Chain)

---

### [NG-101] CRITICAL: upgrade-onchain No Verifica Que el txHash Sea de selfRegisterAgent

- **Severity:** CRITICAL
- **Category:** Business Logic / Spoofing
- **Status:** NEW
- **Location:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts:60-95`
- **Description:** El endpoint verifica que el transaction receipt tenga `status === 'success'`, pero NO verifica que la transaccion sea realmente una llamada a `selfRegisterAgent()` en el contrato WasiAI Marketplace. Un atacante puede:
  1. Enviar cualquier transaccion exitosa (ej: un simple transfer de AVAX)
  2. Proveer ese txHash al endpoint
  3. El backend marca su agente como `registration_type = 'on_chain'` sin registro on-chain real

- **Impact:** Agentes falsos aparecen con badge "On-Chain" sin estar realmente registrados en el smart contract. Esto rompe la integridad del marketplace — los clientes creen estar interactuando con un agente verificado on-chain cuando no lo esta.

- **Evidence:**
  ```typescript
  // upgrade-onchain/route.ts:71-76
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: result.data.txHash as `0x${string}`,
    timeout: 30_000,
  })
  if (receipt.status === 'reverted') { ... }
  // Solo chequea status === 'reverted' — NO verifica que sea selfRegisterAgent()
  // NO verifica que el 'to' sea el contract address
  // NO verifica logs del evento AgentRegistered
  ```

- **Archivos afectados:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts`

---

### [NG-102] MEDIUM: upgrade-onchain Sin Rate Limiting

- **Severity:** MEDIUM
- **Category:** Availability / DoS
- **Status:** NEW
- **Location:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts:19-115`
- **Description:** El endpoint POST no tiene rate limiting. Cada request hace un `waitForTransactionReceipt()` que bloquea hasta 30 segundos contra el nodo RPC. Un atacante puede enviar cientos de requests con txHash invalidos para:
  1. Agotar la cuota de RPC calls del nodo
  2. Crear carga en el servidor con requests pendientes de 30s cada uno

- **Evidence:**
  ```typescript
  // No hay checkRateLimit() al inicio del handler
  export async function POST(req: NextRequest, ...) {
    const csrfError = validateCsrf(req) // Solo CSRF, no rate limit
    ...
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: result.data.txHash as `0x${string}`,
      timeout: 30_000, // 30s block per request
    })
  ```

- **Archivos afectados:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts`

---

### [NG-103] MEDIUM: register/route.ts Responde on_chain_registered:true Antes de Confirmacion

- **Severity:** MEDIUM
- **Category:** Business Logic / State Inconsistency
- **Status:** NEW
- **Location:** `src/app/api/v1/agents/register/route.ts:250-273`
- **Description:** Cuando `register_on_chain = true` y hay `creator_wallet`, la response indica `on_chain_registered: true` (linea 272) antes de que `registerAgentOnChain()` confirme la transaccion. La llamada on-chain es fire-and-forget (`.catch()` solo loguea).

  Si la transaccion on-chain falla (gas insuficiente, slug duplicado on-chain, contrato pausado), la DB queda con `registration_type: 'on_chain'` pero el agente NO esta registrado on-chain.

- **Evidence:**
  ```typescript
  // register/route.ts:251-257
  if (registerOnChain && data.creator_wallet) {
    registerAgentOnChain({...}).catch(err => logger.error('[register] on-chain failed', { err }))
    // Fire-and-forget — no espera confirmacion
  }

  // register/route.ts:272
  on_chain_registered: registerOnChain && !!data.creator_wallet,
  // Retorna true sin verificar que la tx on-chain haya pasado
  ```

- **Archivos afectados:** `src/app/api/v1/agents/register/route.ts`

---

### [NG-104] MEDIUM: discover_agents_v2 RPC Usa SECURITY DEFINER

- **Severity:** MEDIUM
- **Category:** Access Control / Privilege Escalation
- **Status:** NEW
- **Location:** `supabase/migrations/039_dual_registration.sql:37-38`
- **Description:** La funcion RPC `discover_agents_v2()` usa `SECURITY DEFINER`, lo que hace que se ejecute con los privilegios del owner de la funcion (normalmente `postgres`). Esto bypassa completamente RLS policies en la tabla `agents`.

  Si un atacante puede inyectar parametros malformados o si hay un bug en la funcion, se podria acceder a agentes con status distinto de `'active'` (ej: agentes en estado `'reviewing'` que no deberian ser publicos).

  Actualmente la funcion filtra `WHERE status = 'active'`, pero la seguridad depende de la logica de la funcion en vez de RLS.

- **Evidence:**
  ```sql
  -- 039_dual_registration.sql:37-38
  SECURITY DEFINER
  AS $$
    SELECT *
    FROM agents
    WHERE status = 'active'
    -- SELECT * retorna TODAS las columnas incluyendo endpoint_url, metadata, etc.
  ```

- **Archivos afectados:** `supabase/migrations/039_dual_registration.sql`

---

### [NG-105] MEDIUM: invoke/route.ts Redis Mutex Fail-Open

- **Severity:** MEDIUM
- **Category:** Concurrency / Double-Spend
- **Status:** NEW
- **Location:** `src/app/api/v1/models/[slug]/invoke/route.ts:248-251`
- **Description:** El mutex Redis para prevenir double-spend concurrente en agent keys es fail-open. Si Redis no esta disponible, la invocacion procede sin el mutex. Aunque el `check_and_deduct_budget` atomico en Supabase es el control principal, la ventana de fail-open permite que dos requests concurrentes ambas pasen el soft-check de budget y ejecuten el upstream call antes de que una sea rechazada por el deduct atomico. El upstream call ya se ejecuto (y consumio recursos del creator) pero solo una sera cobrada.

- **Evidence:**
  ```typescript
  // invoke/route.ts:248-251
  } catch {
    // Redis unavailable — fail-open (rate limiting still applies)
    logger.warn('[invoke] Redis mutex unavailable — proceeding without mutex', ...)
  }
  ```

- **Archivos afectados:** `src/app/api/v1/models/[slug]/invoke/route.ts`

---

### [NG-106] LOW: upgrade-onchain Revela Errores Internos de RPC

- **Severity:** LOW
- **Category:** Information Disclosure
- **Status:** NEW
- **Location:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts:88-94`
- **Description:** El error del catch block incluye el mensaje completo del error del RPC node, que puede revelar URLs internas de RPC, detalles de gas, o informacion de infraestructura.

- **Evidence:**
  ```typescript
  // upgrade-onchain/route.ts:92-93
  return NextResponse.json(
    { error: `Could not verify transaction: ${msg}` },
    // msg puede contener: "request to https://internal-rpc.company.com failed"
  ```

- **Archivos afectados:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts`

---

### [NG-107] LOW: upgrade-onchain No Almacena token_id

- **Severity:** LOW
- **Category:** Data Integrity
- **Status:** NEW
- **Location:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts:98-106`
- **Description:** La migracion 039 agrego la columna `token_id BIGINT` a la tabla agents, pero el endpoint upgrade-onchain no la popula al actualizar. El token_id del evento `AgentRegistered` on-chain se pierde.

- **Evidence:**
  ```typescript
  // upgrade-onchain/route.ts:100-105
  .update({
    registration_type: 'on_chain',
    on_chain_registered: true,
    chain_registered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    // MISSING: token_id from on-chain event logs
  })
  ```

- **Archivos afectados:** `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts`, `supabase/migrations/039_dual_registration.sql`

---

### [NG-108] LOW: transparency/stats Sin Rate Limiting

- **Severity:** LOW
- **Category:** Availability
- **Status:** NEW
- **Location:** `src/app/api/transparency/stats/route.ts:9-33`
- **Description:** Endpoint publico sin rate limiting que hace RPC calls on-chain. Aunque tiene `revalidate = 60` (ISR cache), un atacante puede generar variaciones de URL para bypassar el cache.

- **Evidence:**
  ```typescript
  // transparency/stats/route.ts — sin checkRateLimit
  export const revalidate = 60
  export async function GET() {
    const client = createPublicClient({ chain, transport: http() })
    // RPC call sin rate limiting
  ```

- **Archivos afectados:** `src/app/api/transparency/stats/route.ts`

---

### [NG-109] INFO: RegistrationChoiceModal Crea publicClient en Cada Render

- **Severity:** INFO
- **Category:** Performance
- **Status:** NEW
- **Location:** `src/app/[locale]/publish/RegistrationChoiceModal.tsx:42`
- **Description:** `createPublicClient()` se llama en el cuerpo del componente (no en useEffect/useMemo), creando una nueva conexion RPC en cada render. No es un riesgo de seguridad pero puede causar RPC connection leaks.

- **Archivos afectados:** `src/app/[locale]/publish/RegistrationChoiceModal.tsx`, `src/features/agents/components/UpgradeOnChainModal.tsx`

---

### [NG-110] INFO: config.ts getContractAddress Retorna '0x' Como Fallback

- **Severity:** INFO
- **Category:** Error Handling
- **Status:** NEW
- **Location:** `src/lib/contracts/config.ts:5-8`
- **Description:** `getContractAddress()` retorna `'0x'` como fallback si las env vars no estan seteadas. Esto es una Address invalida que podria causar reverts silenciosos en lugar de errores claros.

- **Evidence:**
  ```typescript
  // config.ts:8
  return (addr ?? '0x') as Address
  // '0x' no es una address valida — podria causar confusión en debug
  ```

- **Archivos afectados:** `src/lib/contracts/config.ts`

---

## PARTE 2 — NexusAudit Findings (On-Chain)

---

### [NA-301] MEDIUM: selfRegisterAgent Permissionless — Slug Squatting / DoS

- **Severity:** MEDIUM
- **Category:** Access Control / Economic
- **Status:** NEW
- **Location:** `contracts/src/WasiAIMarketplace.sol:229-247`
- **Description:** `selfRegisterAgent()` es permissionless (solo `whenNotPaused`). Cualquier wallet puede registrar agentes sin costo (excepto gas). Un atacante puede:
  1. **Slug Squatting**: Registrar slugs populares ("chatgpt", "claude", "gpt4", "dalle") bloqueando a creators legitimos
  2. **Storage Pollution**: Registrar miles de agentes basura llenando el mapping `agents[]`
  3. **Front-running**: Monitorear el mempool y front-runnear `registerAgent()` del operator con `selfRegisterAgent()` usando el mismo slug

  No hay mecanismo para eliminar o reclamar slugs registrados maliciosamente.

- **Evidence:**
  ```solidity
  // WasiAIMarketplace.sol:229-247
  function selfRegisterAgent(
      string  calldata slug,
      uint256 pricePerCall,
      uint64  erc8004Id
  ) external whenNotPaused {
      require(bytes(slug).length > 0, "WasiAI: empty slug");
      // No requiere fee, deposit, o whitelist
      // No hay limite de slug length
      // No hay onlyOperator — cualquier address puede llamar
  ```

- **Archivos afectados:** `contracts/src/WasiAIMarketplace.sol`

---

### [NA-302] MEDIUM: selfRegisterAgent/registerAgent Race — Off-chain/On-chain Inconsistency

- **Severity:** MEDIUM
- **Category:** State Consistency / Race Condition
- **Status:** NEW
- **Location:** `contracts/src/WasiAIMarketplace.sol:201-247`, `src/app/api/v1/agents/register/route.ts:250-257`
- **Description:** Dos paths de registro pueden crear inconsistencias:

  **Escenario 1 (DB primero, on-chain falla):**
  1. Creator llama POST /register con `register_on_chain: true`
  2. Backend inserta en DB con `registration_type: 'on_chain'`
  3. Backend llama `registerAgentOnChain()` fire-and-forget
  4. On-chain falla (slug ya tomado, gas, paused) — `.catch()` solo loguea
  5. DB dice "on_chain" pero contrato dice "no existe"

  **Escenario 2 (On-chain primero via selfRegister, DB despues via upgrade):**
  1. Creator llama `selfRegisterAgent()` directamente en el contrato con wallet A
  2. Otra persona llama POST `/upgrade-onchain` con un txHash de otra tx exitosa (NG-101)
  3. DB marca un agente diferente como "on_chain" con el txHash robado

- **Evidence:**
  ```typescript
  // register/route.ts:251-257
  registerAgentOnChain({...})
    .catch(err => logger.error('[register] on-chain failed', { err }))
  // Fire-and-forget — DB ya tiene registration_type: 'on_chain'
  ```

- **Archivos afectados:** `contracts/src/WasiAIMarketplace.sol`, `src/app/api/v1/agents/register/route.ts`

---

### [NA-303] LOW: selfRegisterAgent No Valida Max Slug Length

- **Severity:** LOW
- **Category:** Input Validation / Gas Griefing
- **Status:** NEW
- **Location:** `contracts/src/WasiAIMarketplace.sol:234`
- **Description:** `selfRegisterAgent()` solo verifica `bytes(slug).length > 0` pero no tiene limite maximo. Un slug de 10KB+ consumiria gas excesivo para storage y haria que `getAgent()` y `settleKeyBatch()` sean mas costosos por el string comparison.

  `registerAgent()` (operator-only) tiene el mismo problema, pero el operador es de confianza. `selfRegisterAgent()` es permissionless.

- **Evidence:**
  ```solidity
  // WasiAIMarketplace.sol:234
  require(bytes(slug).length > 0, "WasiAI: empty slug");
  // No hay: require(bytes(slug).length <= 80, "WasiAI: slug too long");
  ```

- **Archivos afectados:** `contracts/src/WasiAIMarketplace.sol`

---

### [NA-304] LOW: selfRegisterAgent No Valida pricePerCall Minimo/Maximo

- **Severity:** LOW
- **Category:** Input Validation
- **Status:** NEW
- **Location:** `contracts/src/WasiAIMarketplace.sol:229-247`
- **Description:** `selfRegisterAgent()` acepta cualquier `pricePerCall` incluyendo 0 y `type(uint256).max`. Un precio de 0 permitiria invocaciones gratuitas (si el backend no filtra). Un precio de `type(uint256).max` causaria overflow en el calculo de fee split en `recordInvocation()` si se usa.

  El backend de registro API si valida (`z.number().min(0.001).max(100)` en el schema Zod), pero `selfRegisterAgent()` es llamable directamente on-chain sin pasar por el backend.

- **Evidence:**
  ```solidity
  // WasiAIMarketplace.sol:229-247
  function selfRegisterAgent(
      string  calldata slug,
      uint256 pricePerCall, // No min/max validation
      uint64  erc8004Id
  ) external whenNotPaused {
      // pricePerCall se almacena directamente sin validacion
      agents[slug] = Agent({
          creator: msg.sender,
          pricePerCall: pricePerCall, // Puede ser 0 o uint256.max
          erc8004Id: erc8004Id
      });
  ```

- **Archivos afectados:** `contracts/src/WasiAIMarketplace.sol`

---

### [NA-305] INFO: withdrawKey Intencionalmente Sin whenNotPaused

- **Severity:** INFO
- **Category:** Design Decision
- **Status:** NEW (documented)
- **Location:** `contracts/src/WasiAIMarketplace.sol:550`
- **Description:** `withdrawKey()` omite `whenNotPaused` intencionalmente para que los usuarios siempre puedan recuperar sus fondos. Esto es consistente con `emergencyWithdrawKey()` que tambien omite `whenNotPaused`. El comentario NatSpec documenta esta decision.

  No requiere accion — documentado como decision de diseno.

- **Archivos afectados:** `contracts/src/WasiAIMarketplace.sol`

---

### [NA-306] INFO: performUpkeep Callable por Cualquier Address

- **Severity:** INFO
- **Category:** Access Control
- **Status:** NEW (documented)
- **Location:** `contracts/src/WasiAIMarketplace.sol:730-737`
- **Description:** `performUpkeep()` es callable por cualquier address, no solo Chainlink. El intervalo de 23h protege contra spam, pero un griefing attack podria llamarlo justo antes de Chainlink, desperdiciando el gas del keeper. El comentario NatSpec documenta esta decision.

  No requiere accion inmediata — el intervalo de 23h es proteccion suficiente.

- **Archivos afectados:** `contracts/src/WasiAIMarketplace.sol`

---

## PARTE 3 — Validacion de Findings Previos (No-Regression Check)

### v2.0 Findings — Estado Actual

| ID | Hallazgo | v2.0 Estado | v2.1 Estado | Regresion? |
|----|----------|-------------|-------------|------------|
| NG-001 | OAuth x-forwarded-host | FIXED | STILL FIXED | No |
| NG-002 | MCP payment bypass | FIXED | STILL FIXED | No |
| NG-003 | Cron fail-open | FIXED | STILL FIXED | No |
| NG-004 | OAuth Origin | FIXED | STILL FIXED | No |
| NG-005 | SSRF DNS probe | FIXED | STILL FIXED | No |
| NG-006 | Agent key validation | FIXED | STILL FIXED | No |
| NG-007 | Sybil reputation | FIXED | STILL FIXED | No |
| NG-008 | TOCTOU budget | FIXED | STILL FIXED | No |
| NG-009 | MCP SSRF | FIXED | STILL FIXED | No |
| NG-010 | Middleware API headers | FIXED | STILL FIXED | No |
| NG-011 | Rate limiter headers | FIXED | STILL FIXED | No |
| NG-012 | CSRF Referer fallback | FIXED | STILL FIXED | No |
| NG-013 | Service client | FIXED | STILL FIXED | No |
| NG-014 | Env exposure | INFO | INFO | No |
| NA-201 | Treasury timelock | PARTIAL | PARTIAL | No |
| NA-202 | Fee timelock | FIXED | STILL FIXED | No |
| NA-203 | recordInvocation pause | FIXED | STILL FIXED | No |
| NA-204 | creatorFeeBps | FIXED | STILL FIXED | No |
| NA-205 | ReentrancyGuard | FIXED | STILL FIXED | No |
| NA-206 | settleKeyBatch amounts | BY DESIGN | BY DESIGN | No |
| NA-207 | abi.encode | FIXED | STILL FIXED | No |
| NA-208 | depositForKey owner | FIXED | STILL FIXED | No |
| NA-209 | Escrow abi.encode | FIXED | STILL FIXED | No |
| NA-210 | Daily settlement cap | FIXED | STILL FIXED | No |
| NA-211 | Granular roles | PARTIAL | PARTIAL | No |
| NA-212 | Missing events | FIXED | STILL FIXED | No |

**Resultado: 0 regressions detectadas.**

---

## PARTE 4 — Positive Findings (Que Esta Bien en los Cambios Nuevos)

### Smart Contracts
- `selfRegisterAgent()` usa `whenNotPaused` — pausable en emergencia
- `withdrawKey()` permite recovery sin pausas — user-first design
- No se rompio ningun patron existente (CEI, ReentrancyGuard, SafeERC20)
- Solvency counters siguen intactos

### Web App
- `upgrade-onchain/route.ts` valida CSRF correctamente
- `upgrade-onchain/route.ts` verifica ownership (creator_id === user.id)
- `upgrade-onchain/route.ts` verifica estado previo (ya on-chain = 409)
- `upgrade-onchain/route.ts` usa Zod para validar txHash format
- `register/route.ts` mantiene todos los controles existentes (SSRF, rate limit, auth 3-way)
- `discover/route.ts` usa Zod para validar query params
- `RegistrationChoiceModal.tsx` muestra gas estimate antes de firmar
- Migracion 039 tiene retrocompatibilidad con agentes existentes

---

## Plan de Remediacion

### Prioridad INMEDIATA (CRITICAL)

| ID | Titulo | Archivos | Esfuerzo |
|---|---|---|---|
| NG-101 | Verificar txHash es selfRegisterAgent al contrato correcto | 1 | 2h |

### Prioridad ALTA (MEDIUM)

| ID | Titulo | Archivos | Esfuerzo |
|---|---|---|---|
| NG-102 | Rate limiting en upgrade-onchain | 1 | 15min |
| NG-103 | No retornar on_chain_registered:true sin confirmacion | 1 | 30min |
| NG-104 | Cambiar discover_agents_v2 a SECURITY INVOKER | 1 (migration) | 20min |
| NG-105 | Redis mutex fail-closed o log+alert | 1 | 30min |
| NA-301 | Mitigacion slug squatting (fee o whitelist) | 1 (contract) | 2h |
| NA-302 | Reconciliacion on-chain/off-chain | 1-2 | 1h |

### Prioridad MEDIA (LOW)

| ID | Titulo | Archivos | Esfuerzo |
|---|---|---|---|
| NG-106 | Sanitizar error messages de RPC | 1 | 15min |
| NG-107 | Popular token_id en upgrade flow | 1 | 30min |
| NG-108 | Rate limit en stats endpoint | 1 | 15min |
| NA-303 | Max slug length en selfRegisterAgent | 1 (contract) | 10min |
| NA-304 | Min/max pricePerCall en selfRegisterAgent | 1 (contract) | 10min |

### No Requiere Accion (INFO)

| ID | Titulo | Nota |
|---|---|---|
| NG-109 | publicClient en render | Performance optimization, no security |
| NG-110 | config.ts '0x' fallback | Edge case, no exploitable |
| NA-305 | withdrawKey sin whenNotPaused | Documented by design |
| NA-306 | performUpkeep permissionless | Documented, interval protects |

---

## Security Score (v2.1)

| Capa | Score | Delta vs v2.0 | Nota |
|------|-------|---------------|------|
| Off-Chain (Web App) | **8.5/10** | -1.0 | 1 CRITICAL (NG-101) baja el score |
| On-Chain (Smart Contracts) | **8.0/10** | -0.5 | selfRegisterAgent abre superficie nueva |
| **Overall** | **8.3/10** | -0.7 | Requiere fix de NG-101 antes de produccion |

> **Post-fix estimate:** Despues de resolver NG-101 y los MEDIUM findings, el score deberia volver a **9.0/10**.

---

*Reporte generado con NexusAudit v2.0 (TRACE threat model) + NexusGuard v1.0 (SHIELD threat model)*
*Anti-Hallucination Protocol: todos los findings tienen evidencia archivo:linea*
*Baseline: security-audit-v2-consolidated.md + security-validation-report.md*
